import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type ChineseWriterPlugin from "./main";
import type { TreeNode, FileParseResult } from "./types";

export const VIEW_TYPE_TREE = "chinese-writer-tree-view";

/**
 * 树状视图
 */
export class TreeView extends ItemView {
  plugin: ChineseWriterPlugin;
  private treeData: TreeNode[] = [];
  private allExpanded: boolean = false;

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
    return "book-open";
  }

  async onOpen(): Promise<void> {
    await this.refresh();
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
    setIcon(iconEl, "folder");

    const folderName = this.plugin.settings.targetFolder || "未设置目录";
    titleEl.createSpan({
      text: folderName,
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

    // 重新加载数据
    await this.loadData();

    // 恢复展开状态
    this.restoreExpandedStates(expandedStates);

    // 只更新内容，不重建整个 DOM
    const container = this.containerEl.children[1];
    if (!container) return;

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
      // 使用层级路径作为唯一标识
      const key = this.getNodeKey(node, parentKey);
      states.set(key, node.expanded);

      if (node.children.length > 0) {
        this.collectExpandedStates(node.children, states, key);
      }
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
    const folderPath = this.plugin.settings.targetFolder;
    if (!folderPath) {
      this.treeData = [];
      return;
    }

    const parser = this.plugin.parser;
    const files = parser.getMarkdownFilesInFolder(folderPath);

    // 解析所有文件
    const parseResults = [];
    for (const file of files) {
      const parseResult = await parser.parseFile(file);
      if (parseResult) {
        parseResults.push(parseResult);
      }
    }

    // 应用文件排序
    const fileOrder = this.plugin.orderManager.getFileOrder();
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
        const h2Node: TreeNode = {
          id: `${h1Node.id}-h2-${h2Index}`,
          text: h2.text,
          type: "h2",
          children: [],
          expanded: false,
          content: h2.content,
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

    // 节点文本
    const textEl = nodeContent.createSpan({
      text: node.text,
      cls: `tree-item-text tree-item-${node.type}`,
    });

    // H2 数量统计（仅在文件和 H1 节点显示）
    if (node.type === "file" || node.type === "h1") {
      const h2Count = this.countH2(node);
      if (h2Count > 0) {
        const countEl = nodeContent.createSpan({
          text: `[${h2Count}]`,
          cls: "tree-item-count",
        });
      }
    }

    // 点击事件
    nodeContent.addEventListener("click", () => {
      this.onNodeClick(node);
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
    console.log("Node clicked:", node);
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
      console.log("Parent file node not found");
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
        console.log("H1 index not found", { draggedIndex, targetIndex, h1Texts });
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

      console.log("Reordering H1 in same file:", { filePath: draggedFileNode.filePath, newOrder: h1Texts });
      await this.plugin.orderManager.reorderH1InFile(draggedFileNode.filePath, h1Texts);
    } else {
      // 跨文件移动
      if (!draggedFileNode.filePath || !targetFileNode.filePath) return;

      console.log("Moving H1 across files:", {
        from: draggedFileNode.filePath,
        to: targetFileNode.filePath,
        h1: draggedNode.text,
        insertBefore: this.insertBefore
      });

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
      console.log("Parent nodes not found");
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
        console.log("H2 index not found", { draggedIndex, targetIndex, h2Texts });
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

      console.log("Reordering H2 in same H1:", {
        filePath: draggedFileNode.filePath,
        h1: draggedH1Node.text,
        newOrder: h2Texts
      });

      await this.plugin.orderManager.reorderH2InFile(draggedFileNode.filePath, draggedH1Node.text, h2Texts);
    } else {
      // 跨 H1 或跨文件移动
      if (!draggedFileNode.filePath || !targetFileNode.filePath) return;

      console.log("Moving H2 across H1/files:", {
        fromFile: draggedFileNode.filePath,
        fromH1: draggedH1Node.text,
        toFile: targetFileNode.filePath,
        toH1: targetH1Node.text,
        h2: draggedNode.text,
        insertBefore: this.insertBefore
      });

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
}
