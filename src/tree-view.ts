import { ItemView, WorkspaceLeaf, setIcon, Menu, TFile, MarkdownView } from "obsidian";
import { EditorView } from "@codemirror/view";
import type ChineseWriterPlugin from "./main";
import type { TreeNode, FileParseResult } from "./types";
import { TextInputModal, ConfirmModal } from "./modals";

export const VIEW_TYPE_TREE = "chinese-writer-tree-view";

/**
 * 树状视图
 */
export class TreeView extends ItemView {
  plugin: ChineseWriterPlugin;
  private treeData: TreeNode[] = [];
  private allExpanded: boolean = false;
  private lastObservedActiveFilePath: string | null = null;
  private currentSettingFolder: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ChineseWriterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_TREE;
  }

  getDisplayText(): string {
    return "中文写作";
  }

  getIcon(): string {
    return "book-type";
  }

  async onOpen(): Promise<void> {
    await this.refresh();
    this.lastObservedActiveFilePath = this.getContextFile()?.path ?? null;

    // 监听活动文件变化
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", async (leaf) => {
        let currentPath = this.lastObservedActiveFilePath;
        if (leaf?.view instanceof MarkdownView) {
          currentPath = leaf.view.file?.path ?? null;
        }
        if (currentPath === this.lastObservedActiveFilePath) {
          return;
        }
        this.lastObservedActiveFilePath = currentPath;
        await this.smartUpdate();
      })
    );
  }

  async onClose(): Promise<void> {
    // 清理拖动定位线
    this.removeDropIndicator();
  }

  /**
   * 刷新视图（完全重建，用于初始化或设置变更）
   */
  async refresh(): Promise<void> {
    const container = this.containerEl.children[1];
    if (!container) return;

    container.empty();
    container.addClass("chinese-writer-view");

    // 创建标题栏
    const headerEl = container.createDiv({ cls: "chinese-writer-header" });

    // 标题栏中间：图标 + 目录名
    const titleEl = headerEl.createDiv({ cls: "chinese-writer-title" });
    const iconEl = titleEl.createSpan({ cls: "chinese-writer-icon" });
    setIcon(iconEl, "book-type");

    // 获取当前显示的文件夹路径
    const activeFile = this.getContextFile();
    let displayFolder = "未设置目录";

    if (activeFile) {
      const settingFolder = this.plugin.highlightManager.getSettingFolderForFile(activeFile.path);
      if (settingFolder) {
        displayFolder = this.getFolderDisplayName(settingFolder);
      }
    }

    titleEl.createSpan({
      text: displayFolder,
      cls: "chinese-writer-folder-name"
    });

    // 标题栏右侧：展开/折叠按钮
    const toggleBtn = headerEl.createEl("button", {
      cls: "chinese-writer-toggle-btn",
    });
    setIcon(toggleBtn, this.allExpanded ? "list-chevrons-down-up" : "list-chevrons-up-down");
    toggleBtn.setAttribute("aria-label", "展开/折叠全部");
    toggleBtn.addEventListener("click", () => {
      this.toggleAllNodes();
    });

    // 创建树容器
    const treeContainer = container.createDiv({
      cls: "chinese-writer-tree-container",
    });

    // 为树容器添加右键菜单（空白区域）
    treeContainer.addEventListener("contextmenu", (e) => {
      // 检查是否点击在空白区域（不是节点）
      const target = e.target as HTMLElement;
      if (target.classList.contains("chinese-writer-tree-container") ||
        target.classList.contains("chinese-writer-tree") ||
        target.classList.contains("chinese-writer-empty")) {
        e.preventDefault();
        e.stopPropagation();
        this.showEmptyAreaContextMenu(e);
      }
    });

    // 加载数据
    await this.loadData();

    // 渲染树
    this.renderTree(treeContainer, this.treeData);
  }

  /**
   * 智能更新视图（保持展开/折叠状态，避免闪烁）
   */
  async smartUpdate(): Promise<void> {
    // 保存当前所有节点的展开状态
    const expandedStates = this.saveExpandedStates();
    await this.persistExpandedStatesForCurrentFolder(expandedStates);

    // 重新加载数据
    await this.loadData();

    // 恢复展开状态
    this.restoreExpandedStates(expandedStates);

    // 只更新内容，不重建整个 DOM
    const container = this.containerEl.children[1];
    if (!container) return;
    this.updateHeaderFolderName(container as HTMLElement);

    const treeContainer = container.querySelector(".chinese-writer-tree-container");
    if (!treeContainer) return;

    // 清空并重新渲染树
    treeContainer.empty();
    this.renderTree(treeContainer as HTMLElement, this.treeData);
  }

  /**
   * 保存所有节点的展开状态
   */
  private saveExpandedStates(): Map<string, boolean> {
    const states = new Map<string, boolean>();
    this.collectExpandedStates(this.treeData, states);
    return states;
  }

  /**
   * 递归收集展开状态
   */
  private collectExpandedStates(nodes: TreeNode[], states: Map<string, boolean>, parentKey: string = ""): void {
    nodes.forEach((node) => {
      if (node.children.length === 0) {
        return;
      }

      // 使用层级路径作为唯一标识
      const key = this.getNodeKey(node, parentKey);
      states.set(key, node.expanded);

      this.collectExpandedStates(node.children, states, key);
    });
  }

  /**
   * 获取节点的唯一标识键（基于层级路径）
   */
  private getNodeKey(node: TreeNode, parentKey: string = ""): string {
    let key = "";

    if (node.type === "file" && node.filePath) {
      key = `file:${node.filePath}`;
    } else if (node.type === "h1") {
      // H1 使用父节点（文件）+ H1 文本
      key = `${parentKey}>>h1:${node.text}`;
    } else if (node.type === "h2") {
      // H2 使用父节点（H1）+ H2 文本
      key = `${parentKey}>>h2:${node.text}`;
    } else {
      key = node.id;
    }

    return key;
  }

  /**
   * 恢复展开状态
   */
  private restoreExpandedStates(states: Map<string, boolean>): void {
    this.applyExpandedStates(this.treeData, states, "");
  }

  /**
   * 递归应用展开状态
   */
  private applyExpandedStates(nodes: TreeNode[], states: Map<string, boolean>, parentKey: string = ""): void {
    nodes.forEach((node) => {
      const key = this.getNodeKey(node, parentKey);
      const savedState = states.get(key);

      if (savedState !== undefined) {
        node.expanded = savedState;
      }

      if (node.children.length > 0) {
        this.applyExpandedStates(node.children, states, key);
      }
    });
  }

  /**
   * 加载数据
   */
  async loadData(): Promise<void> {
    // 获取当前上下文文件（活动文件或最近 Markdown 文件）
    const activeFile = this.getContextFile();
    let folderPath: string | null = null;

    // 如果有活动文件，检查是否在某个小说库中
    if (activeFile) {
      folderPath = this.plugin.highlightManager.getSettingFolderForFile(activeFile.path);
    }

    this.currentSettingFolder = folderPath;

    if (!folderPath) {
      this.treeData = [];
      return;
    }

    const parser = this.plugin.parser;
    const files = parser.getMarkdownFilesInFolder(folderPath);

    // 并行解析所有文件
    const parsedList = await Promise.all(files.map((file) => parser.parseFile(file)));
    const parseResults = parsedList.filter((item): item is FileParseResult => item !== null);

    // 应用文件排序；若 order.json 为空，按当前树顺序初始化一次
    let fileOrder = this.plugin.orderManager.getFileOrder();
    if (fileOrder.length === 0 && parseResults.length > 0) {
      fileOrder = parseResults.map((item) => item.filePath);
      await this.plugin.orderManager.setFileOrder(fileOrder);
    }

    if (fileOrder.length > 0) {
      parseResults.sort((a, b) => {
        const indexA = fileOrder.indexOf(a.filePath);
        const indexB = fileOrder.indexOf(b.filePath);
        if (indexA === -1 && indexB === -1) return 0;
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
      });
    }

    // 创建树节点
    this.treeData = [];
    let fileIndex = 0;
    for (const parseResult of parseResults) {
      const fileNode = this.createFileNode(parseResult, fileIndex++);
      this.treeData.push(fileNode);
    }

    const persistedStates = this.plugin.orderManager.getExpandedStates(folderPath);
    const persistedEntries = Object.entries(persistedStates);
    if (persistedEntries.length > 0) {
      this.restoreExpandedStates(new Map<string, boolean>(persistedEntries));
    }
  }

  /**
   * 创建文件节点
   */
  private createFileNode(
    parseResult: FileParseResult,
    index: number
  ): TreeNode {
    const fileNode: TreeNode = {
      id: `file-${index}`,
      text: parseResult.fileName,
      type: "file",
      children: [],
      expanded: false,
      filePath: parseResult.filePath,
    };

    // 直接使用文件中的 H1 顺序（不需要排序）
    parseResult.h1List.forEach((h1, h1Index) => {
      const h1Node: TreeNode = {
        id: `${fileNode.id}-h1-${h1Index}`,
        text: h1.text,
        type: "h1",
        children: [],
        expanded: false,
      };

      // 直接使用文件中的 H2 顺序（不需要排序）
      h1.h2List.forEach((h2, h2Index) => {
        const status = this.extractStatusFromLines(h2.content);
        const h2Node: TreeNode = {
          id: `${h1Node.id}-h2-${h2Index}`,
          text: h2.text,
          type: "h2",
          children: [],
          expanded: false,
          content: h2.content,
          status,
        };

        h1Node.children.push(h2Node);
      });

      fileNode.children.push(h1Node);
    });

    return fileNode;
  }

  /**
   * 渲染树
   */
  private renderTree(container: HTMLElement, nodes: TreeNode[]): void {
    if (nodes.length === 0) {
      container.createDiv({
        text: "未找到文件或目录为空",
        cls: "chinese-writer-empty",
      });
      return;
    }

    const ul = container.createEl("ul", { cls: "chinese-writer-tree" });

    nodes.forEach((node) => {
      this.renderNode(ul, node);
    });
  }

  /**
   * 渲染单个节点
   */
  private renderNode(parent: HTMLElement, node: TreeNode): void {
    const li = parent.createEl("li", { cls: "tree-item" });
    li.setAttribute("data-node-id", node.id);
    li.setAttribute("data-node-type", node.type);

    // 节点内容容器
    const nodeContent = li.createDiv({ cls: "tree-item-content" });
    nodeContent.setAttribute("draggable", "true");

    // 添加拖放事件到内容容器（不是 li，避免子节点干扰）
    nodeContent.addEventListener("dragstart", (e) => {
      e.stopPropagation(); // 阻止冒泡
      this.onDragStart(e, node);
    });
    nodeContent.addEventListener("dragover", (e) => {
      e.stopPropagation(); // 阻止冒泡
      this.onDragOver(e, node);
    });
    nodeContent.addEventListener("dragleave", (e) => {
      e.stopPropagation(); // 阻止冒泡
      this.onDragLeave(e);
    });
    nodeContent.addEventListener("drop", (e) => {
      e.stopPropagation(); // 阻止冒泡
      this.onDrop(e, node);
    });
    nodeContent.addEventListener("dragend", (e) => {
      e.stopPropagation(); // 阻止冒泡
      this.onDragEnd(e);
    });

    // 展开/折叠图标（只有有子节点的才显示）
    if (node.children.length > 0) {
      const toggleIcon = nodeContent.createSpan({
        cls: "tree-item-toggle",
      });
      setIcon(
        toggleIcon,
        node.expanded ? "chevron-down" : "chevron-right"
      );
      toggleIcon.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleNode(node, li);
      });
    } else {
      // 占位符，保持对齐
      nodeContent.createSpan({ cls: "tree-item-toggle-placeholder" });
    }

    // 节点图标
    const iconEl = nodeContent.createSpan({ cls: "tree-item-icon" });
    const iconName =
      node.type === "file"
        ? "file-text"
        : node.type === "h1"
          ? "heading-1"
          : "heading-2";
    setIcon(iconEl, iconName);

    // 阻止图标的点击事件冒泡
    iconEl.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    // 节点文本
    const textEl = nodeContent.createSpan({
      text: node.text,
      cls: `tree-item-text tree-item-${node.type}`,
    });
    if (node.type === "h2" && this.isDeadStatus(node.status)) {
      textEl.addClass("tree-item-h2-dead");
    }
    if (node.type === "h2") {
      const h1Node = this.findParentH1Node(node);
      const fileNode = this.findParentFileNode(node);
      if (this.currentSettingFolder && h1Node && fileNode?.filePath) {
        nodeContent.addClass("cw-tree-preview-anchor");
        nodeContent.setAttribute("data-cw-tree-setting-folder", this.currentSettingFolder);
        nodeContent.setAttribute("data-cw-tree-file-path", fileNode.filePath);
        nodeContent.setAttribute("data-cw-tree-h1", h1Node.text);
        nodeContent.setAttribute("data-cw-tree-h2", node.text);
        nodeContent.setAttribute("data-cw-tree-keyword", node.text);
      }
    }

    // H2 数量统计（仅在文件和 H1 节点显示）
    if (node.type === "file" || node.type === "h1") {
      const h2Count = this.countH2(node);
      if (h2Count > 0) {
        nodeContent.createSpan({
          text: `[${h2Count}]`,
          cls: "tree-item-count",
        });
      }
    }

    // 点击事件
    nodeContent.addEventListener("click", () => {
      this.onNodeClick(node);
    });

    // 右键菜单事件
    nodeContent.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showContextMenu(e, node);
    });

    // 子节点容器
    if (node.children.length > 0) {
      const childrenUl = li.createEl("ul", {
        cls: "tree-item-children",
      });
      if (!node.expanded) {
        childrenUl.style.display = "none";
      }

      node.children.forEach((child) => {
        this.renderNode(childrenUl, child);
      });
    }
  }

  /**
   * 切换节点展开/折叠状态
   */
  private toggleNode(node: TreeNode, li: HTMLElement): void {
    node.expanded = !node.expanded;

    const toggleIcon = li.querySelector(".tree-item-toggle");
    const childrenUl = li.querySelector(".tree-item-children") as HTMLElement;

    if (toggleIcon) {
      toggleIcon.empty();
      setIcon(
        toggleIcon as HTMLElement,
        node.expanded ? "chevron-down" : "chevron-right"
      );
    }

    if (childrenUl) {
      childrenUl.style.display = node.expanded ? "block" : "none";
    }

    void this.persistExpandedStatesForCurrentFolder();
  }

  /**
   * 切换所有节点的展开/折叠状态
   */
  private toggleAllNodes(): void {
    this.allExpanded = !this.allExpanded;
    this.setAllNodesExpanded(this.treeData, this.allExpanded);

    // 更新 DOM 中的所有节点
    this.updateAllNodesInDOM(this.allExpanded);

    // 更新按钮图标
    const container = this.containerEl.children[1];
    if (!container) return;

    const toggleBtn = container.querySelector(".chinese-writer-toggle-btn");
    if (toggleBtn) {
      toggleBtn.empty();
      setIcon(
        toggleBtn as HTMLElement,
        this.allExpanded ? "list-chevrons-down-up" : "list-chevrons-up-down"
      );
    }

    void this.persistExpandedStatesForCurrentFolder();
  }

  /**
   * 递归设置所有节点的展开状态
   */
  private setAllNodesExpanded(nodes: TreeNode[], expanded: boolean): void {
    nodes.forEach((node) => {
      node.expanded = expanded;
      if (node.children.length > 0) {
        this.setAllNodesExpanded(node.children, expanded);
      }
    });
  }

  /**
   * 更新 DOM 中所有节点的展开/折叠状态
   */
  private updateAllNodesInDOM(expanded: boolean): void {
    const container = this.containerEl.children[1];
    if (!container) return;

    // 获取所有树节点
    const allItems = container.querySelectorAll(".tree-item");

    allItems.forEach((item) => {
      const nodeId = item.getAttribute("data-node-id");
      if (!nodeId) return;

      // 查找对应的节点数据
      const node = this.findNodeById(this.treeData, nodeId);
      if (!node || node.children.length === 0) return;

      // 更新展开/折叠图标
      const toggleIcon = item.querySelector(".tree-item-toggle");
      if (toggleIcon) {
        toggleIcon.empty();
        setIcon(
          toggleIcon as HTMLElement,
          expanded ? "chevron-down" : "chevron-right"
        );
      }

      // 更新子节点容器的显示状态
      const childrenUl = item.querySelector(".tree-item-children") as HTMLElement;
      if (childrenUl) {
        childrenUl.style.display = expanded ? "block" : "none";
      }
    });
  }

  /**
   * 根据 ID 查找节点
   */
  private findNodeById(nodes: TreeNode[], id: string): TreeNode | null {
    for (const node of nodes) {
      if (node.id === id) {
        return node;
      }
      if (node.children.length > 0) {
        const found = this.findNodeById(node.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * 计算节点下的 H2 数量
   */
  private countH2(node: TreeNode): number {
    let count = 0;

    if (node.type === "file") {
      // 文件节点：统计所有 H1 下的 H2
      node.children.forEach((h1Node) => {
        count += h1Node.children.length;
      });
    } else if (node.type === "h1") {
      // H1 节点：统计直接子节点中的 H2
      count = node.children.length;
    }

    return count;
  }

  /**
   * 节点点击事件
   */
  private onNodeClick(node: TreeNode): void {
    // 可以在这里添加点击节点后的行为
    // 例如：跳转到对应的文件位置
  }

  private getContextFile(): TFile | null {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      return activeFile;
    }

    if (this.lastObservedActiveFilePath) {
      const abstractFile = this.app.vault.getAbstractFileByPath(this.lastObservedActiveFilePath);
      if (abstractFile instanceof TFile) {
        return abstractFile;
      }
    }

    return null;
  }

  private extractStatusFromLines(lines: string[]): string {
    const statusTag = "【状态】";
    for (const line of lines) {
      const tagIndex = line.indexOf(statusTag);
      if (tagIndex === -1) continue;
      const rawStatus = line.slice(tagIndex + statusTag.length).trim();
      if (rawStatus) return rawStatus;
    }
    return "";
  }

  private isDeadStatus(status: string | undefined): boolean {
    if (!status) return false;
    const normalized = status.trim();
    return normalized === "死亡" || normalized === "失效";
  }

  private updateHeaderFolderName(container: HTMLElement): void {
    const folderNameEl = container.querySelector(".chinese-writer-folder-name");
    if (!folderNameEl) return;
    folderNameEl.setText(this.getFolderDisplayName(this.currentSettingFolder));
  }

  private getFolderDisplayName(folderPath: string | null | undefined): string {
    if (!folderPath) return "未设置目录";
    const segments = folderPath
      .split(/[\\/]/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    return segments[segments.length - 1] ?? "未设置目录";
  }

  private async persistExpandedStatesForCurrentFolder(
    states?: Map<string, boolean>
  ): Promise<void> {
    if (!this.currentSettingFolder) return;
    const mapToSave = states ?? this.saveExpandedStates();
    const serializedStates: Record<string, boolean> = {};
    mapToSave.forEach((value, key) => {
      serializedStates[key] = value;
    });
    await this.plugin.orderManager.setExpandedStates(this.currentSettingFolder, serializedStates);
  }

  // ========== 拖放功能 ==========

  private draggedNode: TreeNode | null = null;
  private dropIndicator: HTMLElement | null = null;
  private insertBefore: boolean = false; // 记录插入位置

  /**
   * 拖动开始
   */
  private onDragStart(e: DragEvent, node: TreeNode): void {
    this.draggedNode = node;
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", node.id);

    // 创建拖动定位线
    this.createDropIndicator();
  }

  /**
   * 拖动经过
   */
  private onDragOver(e: DragEvent, targetNode: TreeNode): void {
    e.preventDefault();

    if (!this.draggedNode) return;

    // H1 拖到文件上：移动到该文件末尾
    if (this.draggedNode.type === "h1" && targetNode.type === "file") {
      e.dataTransfer!.dropEffect = "move";
      const target = e.currentTarget as HTMLElement;
      // 显示定位线在文件节点下方，表示放入末尾
      this.showDropIndicator(target, false);
      return;
    }

    // H2 拖到 H1 上：移动到该 H1 末尾
    if (this.draggedNode.type === "h2" && targetNode.type === "h1") {
      e.dataTransfer!.dropEffect = "move";
      const target = e.currentTarget as HTMLElement;
      // 显示定位线在 H1 节点下方，表示放入末尾
      this.showDropIndicator(target, false);
      return;
    }

    // 只检查类型是否相同，允许跨父节点移动
    if (targetNode.type !== this.draggedNode.type) {
      // 不同级，不显示定位线
      this.hideDropIndicator();
      e.dataTransfer!.dropEffect = "none";
      return;
    }

    // 不能拖到自己上
    if (targetNode.id === this.draggedNode.id) {
      this.hideDropIndicator();
      e.dataTransfer!.dropEffect = "none";
      return;
    }

    e.dataTransfer!.dropEffect = "move";

    const target = e.currentTarget as HTMLElement;

    // 计算鼠标位置，判断插入位置
    const rect = target.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    this.insertBefore = e.clientY < midY; // 保存插入位置

    // 显示定位线
    this.showDropIndicator(target, this.insertBefore);
  }

  /**
   * 创建拖动定位线
   */
  private createDropIndicator(): void {
    if (this.dropIndicator) return;

    this.dropIndicator = document.createElement("div");
    this.dropIndicator.addClass("drop-indicator");
    document.body.appendChild(this.dropIndicator);
  }

  /**
   * 显示拖动定位线
   */
  private showDropIndicator(target: HTMLElement, insertBefore: boolean): void {
    if (!this.dropIndicator || !this.draggedNode) return;

    // target 就是 tree-item-content 元素
    const rect = target.getBoundingClientRect();

    // 设置定位线位置
    this.dropIndicator.style.display = "block";
    this.dropIndicator.style.left = `${rect.left}px`;
    this.dropIndicator.style.width = `${rect.width}px`;

    if (insertBefore) {
      this.dropIndicator.style.top = `${rect.top - 1}px`;
    } else {
      this.dropIndicator.style.top = `${rect.bottom - 1}px`;
    }
  }

  /**
   * 拖动离开
   */
  private onDragLeave(e: DragEvent): void {
    // 只有当真正离开元素时才隐藏（不是进入子元素）
    const target = e.currentTarget as HTMLElement;
    const relatedTarget = e.relatedTarget as HTMLElement;

    if (!target.contains(relatedTarget)) {
      // 不立即隐藏，因为可能马上进入另一个元素
    }
  }

  /**
   * 隐藏拖动定位线
   */
  private hideDropIndicator(): void {
    if (this.dropIndicator) {
      this.dropIndicator.style.display = "none";
    }
  }

  /**
   * 移除拖动定位线
   */
  private removeDropIndicator(): void {
    if (this.dropIndicator) {
      this.dropIndicator.remove();
      this.dropIndicator = null;
    }
  }

  /**
   * 放置
   */
  private async onDrop(e: DragEvent, targetNode: TreeNode): Promise<void> {
    e.preventDefault();
    e.stopPropagation();

    // 隐藏定位线
    this.hideDropIndicator();

    if (!this.draggedNode || this.draggedNode.id === targetNode.id) {
      return;
    }

    // H1 拖到文件上：移动到该文件末尾
    if (this.draggedNode.type === "h1" && targetNode.type === "file") {
      await this.moveH1ToFileEnd(this.draggedNode, targetNode);
      return;
    }

    // H2 拖到 H1 上：移动到该 H1 末尾
    if (this.draggedNode.type === "h2" && targetNode.type === "h1") {
      await this.moveH2ToH1End(this.draggedNode, targetNode);
      return;
    }

    // 检查是否同级
    if (this.draggedNode.type !== targetNode.type) {
      return;
    }

    // 执行排序
    await this.reorderNodes(this.draggedNode, targetNode);
  }

  /**
   * 拖动结束
   */
  private onDragEnd(e: DragEvent): void {
    const target = e.currentTarget as HTMLElement;
    target.removeClass("dragging");

    // 移除定位线
    this.removeDropIndicator();

    this.draggedNode = null;
  }

  /**
   * 将 H2 移动到目标 H1 末尾
   */
  private async moveH2ToH1End(draggedNode: TreeNode, targetH1Node: TreeNode): Promise<void> {
    const draggedH1Node = this.findParentH1Node(draggedNode);
    const draggedFileNode = this.findParentFileNode(draggedNode);
    const targetFileNode = this.findParentFileNode(targetH1Node);

    if (!draggedH1Node || !draggedFileNode || !targetFileNode) return;

    // 若目标 H1 和来源 H1 相同，不做操作
    if (draggedH1Node.id === targetH1Node.id) return;

    if (!draggedFileNode.filePath || !targetFileNode.filePath) return;

    await this.plugin.orderManager.moveH2ToEndOfH1(
      draggedFileNode.filePath,
      draggedH1Node.text,
      targetFileNode.filePath,
      targetH1Node.text,
      draggedNode.text
    );

    await this.smartUpdate();
  }

  /**
   * 将 H1 移动到目标文件末尾
   */
  private async moveH1ToFileEnd(draggedNode: TreeNode, targetFileNode: TreeNode): Promise<void> {
    const draggedFileNode = this.findParentFileNode(draggedNode);
    if (!draggedFileNode) return;

    // 若目标文件和来源文件相同，不做操作
    if (draggedFileNode.id === targetFileNode.id) return;

    if (!draggedFileNode.filePath || !targetFileNode.filePath) return;

    await this.plugin.orderManager.moveH1ToEndOfFile(
      draggedFileNode.filePath,
      targetFileNode.filePath,
      draggedNode.text
    );

    await this.smartUpdate();
  }

  /**
   * 重新排序节点
   */
  private async reorderNodes(draggedNode: TreeNode, targetNode: TreeNode): Promise<void> {
    if (draggedNode.type === "file") {
      await this.reorderFiles(draggedNode, targetNode);
    } else if (draggedNode.type === "h1") {
      await this.reorderH1(draggedNode, targetNode);
    } else if (draggedNode.type === "h2") {
      await this.reorderH2(draggedNode, targetNode);
    }
  }

  /**
   * 重新排序文件
   */
  private async reorderFiles(draggedNode: TreeNode, targetNode: TreeNode): Promise<void> {
    if (!draggedNode.filePath || !targetNode.filePath) return;

    // 获取所有文件路径
    const filePaths = this.treeData
      .map((node) => node.filePath)
      .filter((path): path is string => path !== undefined);

    // 找到拖动和目标的索引
    const draggedIndex = filePaths.indexOf(draggedNode.filePath);
    let targetIndex = filePaths.indexOf(targetNode.filePath);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // 移除被拖动的元素
    const [removed] = filePaths.splice(draggedIndex, 1);
    if (!removed) return;

    // 重新计算目标索引（因为移除了一个元素）
    targetIndex = filePaths.indexOf(targetNode.filePath);

    // 根据 insertBefore 决定插入位置
    if (this.insertBefore) {
      filePaths.splice(targetIndex, 0, removed);
    } else {
      filePaths.splice(targetIndex + 1, 0, removed);
    }

    // 保存排序
    await this.plugin.orderManager.setFileOrder(filePaths);

    // 刷新视图
    await this.smartUpdate();
  }

  /**
   * 重新排序 H1（支持跨文件移动）
   */
  private async reorderH1(draggedNode: TreeNode, targetNode: TreeNode): Promise<void> {
    const draggedFileNode = this.findParentFileNode(draggedNode);
    const targetFileNode = this.findParentFileNode(targetNode);

    if (!draggedFileNode || !targetFileNode) {
      // console.log("Parent file node not found");
      return;
    }

    const sameFile = draggedFileNode.id === targetFileNode.id;

    if (sameFile) {
      // 同一文件内移动
      if (!draggedFileNode.filePath) return;

      const h1Texts = draggedFileNode.children.map((node) => node.text);
      const draggedIndex = h1Texts.indexOf(draggedNode.text);
      let targetIndex = h1Texts.indexOf(targetNode.text);

      if (draggedIndex === -1 || targetIndex === -1) {
        // console.log("H1 index not found", { draggedIndex, targetIndex, h1Texts });
        return;
      }

      // 移除被拖动的元素
      const [removed] = h1Texts.splice(draggedIndex, 1);
      if (!removed) return;

      // 重新计算目标索引（因为移除了一个元素）
      targetIndex = h1Texts.indexOf(targetNode.text);

      // 根据 insertBefore 决定插入位置
      if (this.insertBefore) {
        h1Texts.splice(targetIndex, 0, removed);
      } else {
        h1Texts.splice(targetIndex + 1, 0, removed);
      }

      // console.log("Reordering H1 in same file:", { filePath: draggedFileNode.filePath, newOrder: h1Texts });
      await this.plugin.orderManager.reorderH1InFile(draggedFileNode.filePath, h1Texts);
    } else {
      // 跨文件移动
      if (!draggedFileNode.filePath || !targetFileNode.filePath) return;

      // console.log("Moving H1 across files:", {
      //   from: draggedFileNode.filePath,
      //   to: targetFileNode.filePath,
      //   h1: draggedNode.text,
      //   insertBefore: this.insertBefore
      // });

      // 从源文件移除 H1
      await this.plugin.orderManager.moveH1BetweenFiles(
        draggedFileNode.filePath,
        targetFileNode.filePath,
        draggedNode.text,
        targetNode.text,
        this.insertBefore
      );
    }

    // 刷新视图
    await this.smartUpdate();
  }

  /**
   * 重新排序 H2（支持跨 H1 和跨文件移动）
   */
  private async reorderH2(draggedNode: TreeNode, targetNode: TreeNode): Promise<void> {
    const draggedH1Node = this.findParentH1Node(draggedNode);
    const targetH1Node = this.findParentH1Node(targetNode);
    const draggedFileNode = this.findParentFileNode(draggedNode);
    const targetFileNode = this.findParentFileNode(targetNode);

    if (!draggedH1Node || !targetH1Node || !draggedFileNode || !targetFileNode) {
      // console.log("Parent nodes not found");
      return;
    }

    const sameH1 = draggedH1Node.id === targetH1Node.id;

    if (sameH1) {
      // 同一 H1 内移动
      if (!draggedFileNode.filePath) return;

      const h2Texts = draggedH1Node.children.map((node) => node.text);
      const draggedIndex = h2Texts.indexOf(draggedNode.text);
      let targetIndex = h2Texts.indexOf(targetNode.text);

      if (draggedIndex === -1 || targetIndex === -1) {
        // console.log("H2 index not found", { draggedIndex, targetIndex, h2Texts });
        return;
      }

      // 移除被拖动的元素
      const [removed] = h2Texts.splice(draggedIndex, 1);
      if (!removed) return;

      // 重新计算目标索引（因为移除了一个元素）
      targetIndex = h2Texts.indexOf(targetNode.text);

      // 根据 insertBefore 决定插入位置
      if (this.insertBefore) {
        h2Texts.splice(targetIndex, 0, removed);
      } else {
        h2Texts.splice(targetIndex + 1, 0, removed);
      }

      // console.log("Reordering H2 in same H1:", {
      //   filePath: draggedFileNode.filePath,
      //   h1: draggedH1Node.text,
      //   newOrder: h2Texts
      // });

      await this.plugin.orderManager.reorderH2InFile(draggedFileNode.filePath, draggedH1Node.text, h2Texts);
    } else {
      // 跨 H1 或跨文件移动
      if (!draggedFileNode.filePath || !targetFileNode.filePath) return;

      // console.log("Moving H2 across H1/files:", {
      //   fromFile: draggedFileNode.filePath,
      //   fromH1: draggedH1Node.text,
      //   toFile: targetFileNode.filePath,
      //   toH1: targetH1Node.text,
      //   h2: draggedNode.text,
      //   insertBefore: this.insertBefore
      // });

      await this.plugin.orderManager.moveH2BetweenH1s(
        draggedFileNode.filePath,
        draggedH1Node.text,
        targetFileNode.filePath,
        targetH1Node.text,
        draggedNode.text,
        targetNode.text,
        this.insertBefore
      );
    }

    // 刷新视图
    await this.smartUpdate();
  }

  /**
   * 查找父文件节点
   */
  private findParentFileNode(node: TreeNode): TreeNode | null {
    // 从 ID 中提取文件索引
    const match = node.id.match(/^file-(\d+)/);
    if (!match || !match[1]) return null;

    const fileIndex = parseInt(match[1]);
    return this.treeData[fileIndex] || null;
  }

  /**
   * 查找父 H1 节点
   */
  private findParentH1Node(node: TreeNode): TreeNode | null {
    // 从 ID 中提取文件和 H1 索引
    const match = node.id.match(/^file-(\d+)-h1-(\d+)/);
    if (!match || !match[1] || !match[2]) return null;

    const fileIndex = parseInt(match[1]);
    const h1Index = parseInt(match[2]);

    const fileNode = this.treeData[fileIndex];
    if (!fileNode) return null;

    return fileNode.children[h1Index] || null;
  }

  // ========== 右键菜单功能 ==========

  /**
   * 显示右键菜单
   */
  private showContextMenu(e: MouseEvent, node: TreeNode): void {
    const menu = new Menu();

    if (node.type === "file") {
      // 一级（文件）显示原来的二级菜单（H1 操作）
      this.addH1ContextMenu(menu, node);
    } else if (node.type === "h1") {
      // 二级（H1）显示原来的三级菜单（H2 操作）
      this.addH2ContextMenu(menu, node);
    } else if (node.type === "h2") {
      // 三级（H2）只显示重命名和删除
      this.addH2SelfContextMenu(menu, node);
    }

    menu.showAtMouseEvent(e);
  }

  /**
   * 显示空白区域右键菜单
   */
  private showEmptyAreaContextMenu(e: MouseEvent): void {
    const menu = new Menu();

    // 空白区域显示原来的一级菜单（文件操作）
    this.addFileContextMenuForEmpty(menu);

    menu.showAtMouseEvent(e);
  }

  /**
   * 添加空白区域的右键菜单（原文件级别菜单）
   */
  private addFileContextMenuForEmpty(menu: Menu): void {
    // 1. 创建集合
    menu.addItem((item) => {
      item
        .setTitle("创建集合")
        .setIcon("file-text")
        .onClick(async () => {
          await this.createFile();
        });
    });
  }

  /**
   * 添加 H1 级别的右键菜单（用于文件节点）
   */
  private addH1ContextMenu(menu: Menu, node: TreeNode): void {
    // 1. 创建集合
    menu.addItem((item) => {
      item
        .setTitle("创建集合")
        .setIcon("file-text")
        .onClick(async () => {
          await this.createFile();
        });
    });

    // 2. 创建分类
    menu.addItem((item) => {
      item
        .setTitle("创建分类")
        .setIcon("heading-1")
        .onClick(async () => {
          await this.createH1(node);
        });
    });

    // 3. 分割线
    menu.addSeparator();

    // 4. 重命名集合
    menu.addItem((item) => {
      item
        .setTitle("重命名集合")
        .setIcon("pencil")
        .onClick(async () => {
          await this.renameFile(node);
        });
    });

    // 5. 删除（原删除集合）
    menu.addItem((item) => {
      item
        .setTitle("删除集合")
        .setIcon("trash")
        .setWarning(true)
        .onClick(async () => {
          await this.deleteFile(node);
        });
    });
  }

  /**
   * 添加 H2 级别的右键菜单（用于 H1 节点）
   */
  private addH2ContextMenu(menu: Menu, node: TreeNode): void {
    // 获取父文件节点
    const fileNode = this.findParentFileNode(node);

    // 1. 创建分类
    if (fileNode) {
      menu.addItem((item) => {
        item
          .setTitle("创建分类")
          .setIcon("heading-1")
          .onClick(async () => {
            await this.createH1(fileNode);
          });
      });
    }

    // 2. 创建设定
    menu.addItem((item) => {
      item
        .setTitle("创建设定")
        .setIcon("heading-2")
        .onClick(async () => {
          await this.createH2(node);
        });
    });

    // 3. 分割线
    menu.addSeparator();

    // 4. 重命名分类
    menu.addItem((item) => {
      item
        .setTitle("重命名分类")
        .setIcon("pencil")
        .onClick(async () => {
          await this.renameH1(node);
        });
    });

    // 5. 删除分类
    menu.addItem((item) => {
      item
        .setTitle("删除分类")
        .setIcon("trash")
        .setWarning(true)
        .onClick(async () => {
          await this.deleteH1(node);
        });
    });
  }

  /**
   * 添加 H2 自身的右键菜单（用于 H2 节点）
   */
  private addH2SelfContextMenu(menu: Menu, node: TreeNode): void {
    // 获取父 H1 节点
    const h1Node = this.findParentH1Node(node);

    // 1. 创建设定
    if (h1Node) {
      menu.addItem((item) => {
        item
          .setTitle("创建设定")
          .setIcon("heading-2")
          .onClick(async () => {
            await this.createH2(h1Node);
          });
      });
    }

    // 2. 编辑设定
    menu.addItem((item) => {
      item
        .setTitle("编辑设定")
        .setIcon("heading-2")
        .onClick(async () => {
          await this.editH2(node);
        });
    });

    // 3. 分割线
    menu.addSeparator();

    // 4. 重命名设定
    menu.addItem((item) => {
      item
        .setTitle("重命名设定")
        .setIcon("pencil")
        .onClick(async () => {
          await this.renameH2(node);
        });
    });

    // 5. 删除设定
    menu.addItem((item) => {
      item
        .setTitle("删除设定")
        .setIcon("trash")
        .setWarning(true)
        .onClick(async () => {
          await this.deleteH2(node);
        });
    });
  }

  // ========== 文件操作 ==========

  /**
   * 创建新文件（集合）
   */
  private async createFile(): Promise<void> {
    const modal = new TextInputModal(
      this.app,
      "创建集合",
      "请输入集合名称",
      "",
      async (value) => {
        if (!value.trim()) return;

        // 获取当前活动文件对应的设定库路径
        const activeFile = this.app.workspace.getActiveFile();
        let folderPath: string | null = null;
        if (activeFile) {
          folderPath = this.plugin.highlightManager.getSettingFolderForFile(activeFile.path);
        }

        if (!folderPath) return;

        const fileName = value.trim();
        const filePath = `${folderPath}/${fileName}.md`;

        // 检查文件是否已存在
        const existingFile = this.app.vault.getAbstractFileByPath(filePath);
        if (existingFile) {
          // 文件已存在，提示用户
          return;
        }

        // 创建新文件，并按设置决定打开位置
        const createdFile = await this.app.vault.create(filePath, "");
        await this.plugin.openFileWithSettings(createdFile);

        // 更新 order.json
        let fileOrder = this.plugin.orderManager.getFileOrder();

        // 如果 order.json 为空，获取目录下所有现有文件
        if (fileOrder.length === 0) {
          const parser = this.plugin.parser;
          const files = parser.getMarkdownFilesInFolder(folderPath);
          fileOrder = files.map(f => f.path);
        } else {
          // 如果 order.json 不为空，只添加新文件
          fileOrder.push(filePath);
        }

        await this.plugin.orderManager.setFileOrder(fileOrder);

        // 等待一小段时间确保 order.json 保存完成
        await new Promise(resolve => setTimeout(resolve, 400));

        // 刷新视图
        await this.smartUpdate();
      }
    );

    modal.open();
  }

  /**
   * 重命名文件（集合）
   */
  private async renameFile(node: TreeNode): Promise<void> {
    if (!node.filePath) return;

    const file = this.app.vault.getAbstractFileByPath(node.filePath);
    if (!(file instanceof TFile)) return;

    const modal = new TextInputModal(
      this.app,
      "重命名集合",
      "请输入新名称",
      node.text,
      async (value) => {
        if (!value.trim() || value.trim() === node.text) return;

        const newName = value.trim();
        const folderPath = node.filePath!.substring(0, node.filePath!.lastIndexOf("/"));
        const newPath = `${folderPath}/${newName}.md`;

        // 重命名文件
        await this.app.fileManager.renameFile(file, newPath);

        // 更新 order.json
        const fileOrder = this.plugin.orderManager.getFileOrder();
        const index = fileOrder.indexOf(node.filePath!);
        if (index !== -1) {
          fileOrder[index] = newPath;
          await this.plugin.orderManager.setFileOrder(fileOrder);
        }

        // 刷新视图
        await this.smartUpdate();
      }
    );

    modal.open();
  }

  /**
   * 删除文件（集合）
   */
  private async deleteFile(node: TreeNode): Promise<void> {
    if (!node.filePath) return;

    const file = this.app.vault.getAbstractFileByPath(node.filePath);
    if (!(file instanceof TFile)) return;

    const modal = new ConfirmModal(
      this.app,
      "删除集合",
      `确定要删除集合"${node.text}"吗？此操作不可恢复。`,
      async () => {
        // 更新 order.json
        let fileOrder = this.plugin.orderManager.getFileOrder();

        // 如果 order.json 为空，获取目录下所有现有文件
        if (fileOrder.length === 0) {
          // 获取当前活动文件对应的设定库路径
          const activeFile = this.app.workspace.getActiveFile();
          let folderPath: string | null = null;
          if (activeFile) {
            folderPath = this.plugin.highlightManager.getSettingFolderForFile(activeFile.path);
          }

          if (folderPath) {
            const parser = this.plugin.parser;
            const files = parser.getMarkdownFilesInFolder(folderPath);
            fileOrder = files.map(f => f.path);
          }
        }

        // 删除文件
        await this.app.fileManager.trashFile(file);

        // 从 order.json 中移除该文件
        const index = fileOrder.indexOf(node.filePath!);
        if (index !== -1) {
          fileOrder.splice(index, 1);
          await this.plugin.orderManager.setFileOrder(fileOrder);
        }

        // 等待一小段时间确保 order.json 保存完成
        await new Promise(resolve => setTimeout(resolve, 400));

        // 刷新视图
        await this.smartUpdate();
      }
    );

    modal.open();
  }

  // ========== H1 操作 ==========

  /**
   * 创建新 H1（分类）
   */
  private async createH1(node: TreeNode): Promise<void> {
    const fileNode = this.findParentFileNode(node);
    if (!fileNode || !fileNode.filePath) return;

    const modal = new TextInputModal(
      this.app,
      "创建分类",
      "请输入分类名称",
      "",
      async (value) => {
        if (!value.trim()) return;

        const h1Text = value.trim();
        const file = this.app.vault.getAbstractFileByPath(fileNode.filePath!);
        if (!(file instanceof TFile)) return;

        // 读取文件内容
        const content = await this.app.vault.read(file);
        const lines = content.split("\n");

        // 在文件末尾添加新的 H1（不添加空行）
        lines.push(`# ${h1Text}`);

        // 写回文件
        await this.app.vault.modify(file, lines.join("\n"));

        // 刷新视图
        await this.smartUpdate();
      }
    );

    modal.open();
  }

  /**
   * 重命名 H1（分类）
   */
  private async renameH1(node: TreeNode): Promise<void> {
    const fileNode = this.findParentFileNode(node);
    if (!fileNode || !fileNode.filePath) return;

    const modal = new TextInputModal(
      this.app,
      "重命名分类",
      "请输入新名称",
      node.text,
      async (value) => {
        if (!value.trim() || value.trim() === node.text) return;

        const newH1Text = value.trim();
        const file = this.app.vault.getAbstractFileByPath(fileNode.filePath!);
        if (!(file instanceof TFile)) return;

        // 读取文件内容
        const content = await this.app.vault.read(file);
        const lines = content.split("\n");

        // 找到目标 H1 并重命名
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          const trimmed = line.trim();

          if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
            const currentH1 = trimmed.substring(2).trim();
            if (currentH1 === node.text) {
              lines[i] = `# ${newH1Text}`;
              break;
            }
          }
        }

        // 写回文件
        await this.app.vault.modify(file, lines.join("\n"));

        // 刷新视图
        await this.smartUpdate();
      }
    );

    modal.open();
  }

  /**
   * 删除 H1（分类）
   */
  private async deleteH1(node: TreeNode): Promise<void> {
    const fileNode = this.findParentFileNode(node);
    if (!fileNode || !fileNode.filePath) return;

    const modal = new ConfirmModal(
      this.app,
      "删除分类",
      `确定要删除分类"${node.text}"及其下的所有内容吗？此操作不可恢复。`,
      async () => {
        const file = this.app.vault.getAbstractFileByPath(fileNode.filePath!);
        if (!(file instanceof TFile)) return;

        // 读取文件内容
        const content = await this.app.vault.read(file);
        const lines = content.split("\n");

        // 找到要删除的 H1 块
        let startIndex = -1;
        let endIndex = lines.length;
        let foundH1 = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          const trimmed = line.trim();

          if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
            const currentH1 = trimmed.substring(2).trim();

            if (currentH1 === node.text) {
              startIndex = i;
              foundH1 = true;
            } else if (foundH1) {
              endIndex = i;
              break;
            }
          }
        }

        if (startIndex === -1) return;

        // 删除 H1 块
        const newLines = [
          ...lines.slice(0, startIndex),
          ...lines.slice(endIndex),
        ];

        // 写回文件
        await this.app.vault.modify(file, newLines.join("\n"));

        // 刷新视图
        await this.smartUpdate();

        // 刷新编辑器高亮(删除H1会删除其下所有H2关键字)
        if (this.plugin.highlightManager) {
          this.plugin.highlightManager.refreshCurrentEditor();
        }
      }
    );

    modal.open();
  }

  // ========== H2 操作 ==========

  /**
   * 创建新 H2（设定）
   */
  private async createH2(node: TreeNode): Promise<void> {
    const h1Node = this.findParentH1Node(node);
    const fileNode = this.findParentFileNode(node);
    if (!h1Node || !fileNode || !fileNode.filePath) return;

    const modal = new TextInputModal(
      this.app,
      "创建设定",
      "请输入设定名称",
      "",
      async (value) => {
        if (!value.trim()) return;

        const h2Text = value.trim();
        const file = this.app.vault.getAbstractFileByPath(fileNode.filePath!);
        if (!(file instanceof TFile)) return;

        // 读取文件内容
        const content = await this.app.vault.read(file);
        const lines = content.split("\n");

        // 找到目标 H1 的结束位置
        let insertIndex = lines.length;
        let inTargetH1 = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          const trimmed = line.trim();

          if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
            const currentH1 = trimmed.substring(2).trim();

            if (currentH1 === h1Node.text) {
              inTargetH1 = true;
            } else if (inTargetH1) {
              insertIndex = i;
              break;
            }
          }
        }

        // 在 H1 末尾插入新的 H2（不添加空行）
        const newLines = [
          ...lines.slice(0, insertIndex),
          `## ${h2Text}`,
          ...lines.slice(insertIndex),
        ];

        // 写回文件
        await this.app.vault.modify(file, newLines.join("\n"));

        // 刷新视图
        await this.smartUpdate();

        // 刷新编辑器高亮
        if (this.plugin.highlightManager) {
          this.plugin.highlightManager.refreshCurrentEditor();
        }
      }
    );

    modal.open();
  }

  /**
   * 重命名 H2（设定）
   */
  private async renameH2(node: TreeNode): Promise<void> {
    const h1Node = this.findParentH1Node(node);
    const fileNode = this.findParentFileNode(node);
    if (!h1Node || !fileNode || !fileNode.filePath) return;

    const modal = new TextInputModal(
      this.app,
      "重命名设定",
      "请输入新名称",
      node.text,
      async (value) => {
        if (!value.trim() || value.trim() === node.text) return;

        const newH2Text = value.trim();
        const file = this.app.vault.getAbstractFileByPath(fileNode.filePath!);
        if (!(file instanceof TFile)) return;

        // 读取文件内容
        const content = await this.app.vault.read(file);
        const lines = content.split("\n");

        // 找到目标 H2 并重命名
        let inTargetH1 = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          const trimmed = line.trim();

          if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
            const currentH1 = trimmed.substring(2).trim();
            inTargetH1 = (currentH1 === h1Node.text);
          } else if (inTargetH1 && trimmed.startsWith("## ") && !trimmed.startsWith("### ")) {
            const currentH2 = trimmed.substring(3).trim();
            if (currentH2 === node.text) {
              lines[i] = `## ${newH2Text}`;
              break;
            }
          }
        }

        // 写回文件
        await this.app.vault.modify(file, lines.join("\n"));

        // 刷新视图
        await this.smartUpdate();

        // 刷新编辑器高亮
        if (this.plugin.highlightManager) {
          this.plugin.highlightManager.refreshCurrentEditor();
        }
      }
    );

    modal.open();
  }

  /**
   * 删除 H2（设定）
   */
  private async deleteH2(node: TreeNode): Promise<void> {
    const h1Node = this.findParentH1Node(node);
    const fileNode = this.findParentFileNode(node);
    if (!h1Node || !fileNode || !fileNode.filePath) return;

    const modal = new ConfirmModal(
      this.app,
      "删除设定",
      `确定要删除设定"${node.text}"及其内容吗？此操作不可恢复。`,
      async () => {
        const file = this.app.vault.getAbstractFileByPath(fileNode.filePath!);
        if (!(file instanceof TFile)) return;

        // 读取文件内容
        const content = await this.app.vault.read(file);
        const lines = content.split("\n");

        // 找到要删除的 H2 块
        let startIndex = -1;
        let endIndex = lines.length;
        let inTargetH1 = false;
        let foundH2 = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          const trimmed = line.trim();

          if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
            const currentH1 = trimmed.substring(2).trim();
            inTargetH1 = (currentH1 === h1Node.text);

            if (inTargetH1 === false && foundH2) {
              endIndex = i;
              break;
            }
          } else if (inTargetH1 && trimmed.startsWith("## ") && !trimmed.startsWith("### ")) {
            const currentH2 = trimmed.substring(3).trim();

            if (currentH2 === node.text) {
              startIndex = i;
              foundH2 = true;
            } else if (foundH2) {
              endIndex = i;
              break;
            }
          }
        }

        if (startIndex === -1) return;

        // 删除 H2 块
        const newLines = [
          ...lines.slice(0, startIndex),
          ...lines.slice(endIndex),
        ];

        // 写回文件
        await this.app.vault.modify(file, newLines.join("\n"));

        // 刷新视图
        await this.smartUpdate();

        // 刷新编辑器高亮
        if (this.plugin.highlightManager) {
          this.plugin.highlightManager.refreshCurrentEditor();
        }
      }
    );

    modal.open();
  }

  private async editH2(node: TreeNode): Promise<void> {
    const h1Node = this.findParentH1Node(node);
    const fileNode = this.findParentFileNode(node);
    if (!h1Node || !fileNode || !fileNode.filePath) return;

    const abstractFile = this.app.vault.getAbstractFileByPath(fileNode.filePath);
    if (!(abstractFile instanceof TFile)) return;

    const content = await this.app.vault.read(abstractFile);
    const lines = content.split("\n");
    const targetLine = this.findFirstContentLine(lines, h1Node.text, node.text);

    const targetLeaf = await this.plugin.openFileWithSettings(abstractFile, { revealWhenNewTab: true });
    if (!targetLeaf) return;
    const targetView = targetLeaf.view instanceof MarkdownView ? targetLeaf.view : null;
    if (!targetView?.editor) return;

    targetView.editor.setCursor({ line: targetLine, ch: 0 });
    this.centerEditorLine(targetView.editor, targetLine);
  }

  private centerEditorLine(
    editor: unknown,
    line: number
  ): void {
    const cmView = (editor as { cm?: EditorView }).cm;
    if (!cmView) return;

    const clampedLine = Math.max(0, Math.min(line, cmView.state.doc.lines - 1));
    const linePos = cmView.state.doc.line(clampedLine + 1).from;
    const centerLine = () => {
      cmView.dispatch({
        effects: EditorView.scrollIntoView(linePos, { y: "center", yMargin: 0 }),
      });
    };

    // 打开文件后视图可能还在布局，补一次延迟居中更稳定
    centerLine();
    window.setTimeout(centerLine, 30);
  }

  private findFirstContentLine(lines: string[], h1Title: string, h2Title: string): number {
    let inTargetH1 = false;
    let inTargetH2 = false;
    let h2Line = 0;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]?.trim() ?? "";

      if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
        inTargetH1 = trimmed.slice(2).trim() === h1Title;
        inTargetH2 = false;
        continue;
      }

      if (inTargetH1 && trimmed.startsWith("## ") && !trimmed.startsWith("### ")) {
        const currentH2 = trimmed.slice(3).trim();
        inTargetH2 = currentH2 === h2Title;
        if (inTargetH2) {
          h2Line = i;
        }
        continue;
      }

      if (inTargetH2) {
        if (trimmed.startsWith("#")) break;
        if (trimmed.length > 0) {
          return i;
        }
      }
    }

    return h2Line;
  }
}
