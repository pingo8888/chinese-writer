import { Plugin, TFile, MarkdownView, WorkspaceLeaf, setIcon, Notice } from "obsidian";
import { ChineseWriterSettings, DEFAULT_SETTINGS, ChineseWriterSettingTab } from "./settings";
import { FileParser } from "./parser";
import { TreeView, VIEW_TYPE_TREE } from "./tree-view";
import { OrderManager } from "./order-manager";
import { HighlightManager } from "./highlight-manager";
import { EditorTypographyManager } from "./editor-typography-manager";
import { MdStatsManager } from "./md-stats-manager";
import { ChapterManager } from "./chapter-manager";

/**
 * 中文写作插件主类
 */
export default class ChineseWriterPlugin extends Plugin {
  settings: ChineseWriterSettings;
  parser: FileParser;
  orderManager: OrderManager;
  highlightManager: HighlightManager;
  editorTypographyManager: EditorTypographyManager;
  mdStatsManager: MdStatsManager;
  chapterManager: ChapterManager;
  private pluginDir = "";
  private settingsFilePath = "";
  private settingMenuRootEl: HTMLElement | null = null;
  private settingMenuChildEl: HTMLElement | null = null;
  private settingMenuCloseTimer: number | null = null;
  private settingMenuExpandDirection: "right" | "left" = "right";
  private h3TitleCacheByFolder: Map<string, Set<string>> = new Map();

  async onload() {
    this.pluginDir = await this.resolvePluginDir();
    this.settingsFilePath = `${this.pluginDir}/cw-setting.json`;

    // 加载设置
    await this.loadSettings();

    // 初始化解析器
    this.parser = new FileParser(this.app.vault);

    // 初始化排序管理器
    this.orderManager = new OrderManager(this.app, this.pluginDir);
    await this.orderManager.load();
    await this.rebuildAllH3TitleCache();

    // 初始化高亮管理器
    this.highlightManager = new HighlightManager(this);
    // 初始化编辑区排版管理器
    this.editorTypographyManager = new EditorTypographyManager(this);
    // 初始化 Markdown 统计管理器
    this.mdStatsManager = new MdStatsManager(this);
    // 初始化章节管理器
    this.chapterManager = new ChapterManager(this);

    // 注册编辑器扩展（关键字高亮）
    this.registerEditorExtension(this.highlightManager.createEditorExtension());
    // 注册编辑器扩展（选区/字数统计）
    this.registerEditorExtension(this.mdStatsManager.createSelectionListenerExtension());
    // 注册编辑器扩展（每 500 字里程碑提示）
    this.registerEditorExtension(this.mdStatsManager.createLineMilestoneExtension());
    // 注册编辑器扩展（标题等级图标）
    this.registerEditorExtension(this.mdStatsManager.createHeadingIconExtension());

    // 初始化高亮样式
    this.highlightManager.updateStyles();
    // 初始化编辑区排版样式
    this.editorTypographyManager.updateStyles();
    // 初始化统计显示
    this.mdStatsManager.setup();

    // 注册视图
    this.registerView(
      VIEW_TYPE_TREE,
      (leaf) => new TreeView(leaf, this)
    );

    // 添加打开视图的命令
    this.addCommand({
      id: "open-tree-view",
      name: "打开文档树视图",
      callback: () => {
        this.activateView();
      },
    });

    // 自动修正当前文档中的标点问题
    this.addCommand({
      id: "auto-fix-punctuation-in-current-file",
      name: "自动修正当前文档标点问题",
      callback: async () => {
        await this.highlightManager.fixPunctuationForActiveEditor();
      },
    });

    // 新建章节：按当前文件所在目录的最大章节号 +1 创建
    this.addCommand({
      id: "create-next-chapter-file",
      name: "新建章节",
      callback: async () => {
        await this.chapterManager.createNextChapterFromActiveFile();
      },
    });

    // 添加功能区图标
    this.addRibbonIcon("book-type", "中文写作", () => {
      this.activateView();
    });

    // 添加设置面板
    this.addSettingTab(new ChineseWriterSettingTab(this.app, this));
    this.register(() => this.closeSettingSubmenus());

    // 编辑器右键菜单：添加设定（两级悬浮子菜单）
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, info) => {
        void this.appendAddSettingEditorMenu(menu, editor, info);
      })
    );

    // 等待 workspace 布局加载完成后初始化高亮
    this.app.workspace.onLayoutReady(() => {
      // 延迟一小段时间确保编辑器完全加载
      setTimeout(() => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView && activeView.file) {
          // 触发一次编辑器刷新以显示高亮
          this.highlightManager.refreshCurrentEditor();
        }
      }, 100);
    });

    // 监听文件变化事件
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        // 当文件被修改时，智能更新视图（保持展开状态）
        if (file instanceof TFile && file.extension === "md") {
          this.mdStatsManager.onVaultFileChanged(file.path);
          this.smartUpdateView();
          this.updateH3CacheForSettingFile(file.path);

          // 如果修改的是设定库中的文件，清除关键字缓存并刷新编辑器
          for (const mapping of this.settings.folderMappings) {
            if (mapping.settingFolder && file.path.startsWith(mapping.settingFolder + "/")) {
              this.highlightManager.clearCache();
              // 触发编辑器重新渲染以更新高亮
              // 延迟执行以确保文件修改完成
              setTimeout(() => {
                this.highlightManager.refreshCurrentEditor();
              }, 100);
              break;
            }
          }
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        // 当新文件被创建时，同步 order.json 并更新视图
        if (file instanceof TFile && file.extension === "md") {
          this.mdStatsManager.onVaultFileChanged(file.path);
          this.syncOrderOnFileCreate(file);
          this.updateH3CacheForSettingFile(file.path);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        // 当文件被删除时，同步 order.json 并更新视图
        if (file instanceof TFile && file.extension === "md") {
          this.mdStatsManager.onVaultFileChanged(file.path);
          this.syncOrderOnFileDelete(file);
          this.updateH3CacheForSettingFile(file.path);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        // 当文件被重命名时，同步 order.json 并更新视图
        if (file instanceof TFile && file.extension === "md") {
          this.mdStatsManager.onVaultFileChanged(oldPath);
          this.mdStatsManager.onVaultFileChanged(file.path);
          this.syncOrderOnFileRename(file, oldPath);
          this.updateH3CacheForSettingFile(oldPath);
          this.updateH3CacheForSettingFile(file.path);
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.mdStatsManager.onActiveLeafChanged();
      })
    );

    // 插件加载时自动打开视图
    this.app.workspace.onLayoutReady(() => {
      this.activateView();
    });
  }

  onunload() {
    // 清理视图
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TREE);
    this.mdStatsManager.destroy();
  }

  /**
   * 激活视图
   */
  async activateView() {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(VIEW_TYPE_TREE)[0];

    if (!leaf) {
      // 在右侧边栏创建新的叶子
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({
          type: VIEW_TYPE_TREE,
          active: true,
        });
        leaf = rightLeaf;
      }
    }

    // 显示视图
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  /**
   * 刷新视图（完全重建）
   */
  async refreshView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TREE);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof TreeView) {
        await view.refresh();
      }
    }
  }

  /**
   * 智能更新视图（保持展开状态）
   */
  async smartUpdateView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TREE);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof TreeView) {
        await view.smartUpdate();
      }
    }
  }

  /**
   * 加载设置
   */
  async loadSettings() {
    const data = await this.readSettingsData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

    // 确保 highlightStyle 的所有字段都有默认值（兼容旧版本）
    if (this.settings.highlightStyle) {
      this.settings.highlightStyle = Object.assign(
        {},
        DEFAULT_SETTINGS.highlightStyle,
        this.settings.highlightStyle
      );
    }

    // 确保 highlightPreviewStyle 的所有字段都有默认值（兼容旧版本）
    if (this.settings.highlightPreviewStyle) {
      this.settings.highlightPreviewStyle = Object.assign(
        {},
        DEFAULT_SETTINGS.highlightPreviewStyle,
        this.settings.highlightPreviewStyle
      );
    } else {
      this.settings.highlightPreviewStyle = Object.assign(
        {},
        DEFAULT_SETTINGS.highlightPreviewStyle
      );
    }

    // 确保 punctuationCheck 的所有字段都有默认值（兼容旧版本）
    if (this.settings.punctuationCheck) {
      this.settings.punctuationCheck = Object.assign(
        {},
        DEFAULT_SETTINGS.punctuationCheck,
        this.settings.punctuationCheck
      );
    } else {
      this.settings.punctuationCheck = Object.assign(
        {},
        DEFAULT_SETTINGS.punctuationCheck
      );
    }

    // 兼容旧版本：openInCurrentTab -> openInNewTab（取反）
    const legacyOpenInCurrentTab = (data as { openInCurrentTab?: boolean } | null)?.openInCurrentTab;
    const hasOpenInNewTab = typeof (data as { openInNewTab?: boolean } | null)?.openInNewTab === "boolean";
    if (!hasOpenInNewTab && typeof legacyOpenInCurrentTab === "boolean") {
      this.settings.openInNewTab = !legacyOpenInCurrentTab;
    }

    // 迁移旧的 targetFolder 配置（如果存在）
    if (data && data.targetFolder && this.settings.folderMappings.length === 0) {
      // 将旧的 targetFolder 转换为一个空的对应关系（仅设定库）
      // 用户需要手动配置小说库路径
      console.log("检测到旧版本配置，已删除 targetFolder 字段。请在设置中配置新的文件夹对应关系。");
    }
  }

  /**
   * 保存设置
   */
  async saveSettings() {
    const adapter = this.app.vault.adapter;
    const parentDir = this.settingsFilePath.substring(0, this.settingsFilePath.lastIndexOf("/"));
    if (parentDir && !(await adapter.exists(parentDir))) {
      await adapter.mkdir(parentDir);
    }
    await adapter.write(this.settingsFilePath, JSON.stringify(this.settings, null, 2));
  }

  private async resolvePluginDir(): Promise<string> {
    const adapter = this.app.vault.adapter;
    const manifestDir = this.manifest.dir?.trim();
    const id = this.manifest.id?.trim() ?? "";
    const lowerId = id.toLowerCase();

    const candidates = Array.from(
      new Set(
        [
          manifestDir,
          id ? `.obsidian/plugins/${id}` : null,
          lowerId ? `.obsidian/plugins/${lowerId}` : null,
        ].filter((item): item is string => !!item && item.length > 0)
      )
    );

    // 优先：能找到现有 settings/view 数据文件的目录
    for (const dir of candidates) {
      if (
        (await adapter.exists(`${dir}/cw-setting.json`)) ||
        (await adapter.exists(`${dir}/cw-view-datas.json`)) ||
        (await adapter.exists(`${dir}/settings.json`)) ||
        (await adapter.exists(`${dir}/data.json`)) ||
        (await adapter.exists(`${dir}/view-datas.json`)) ||
        (await adapter.exists(`${dir}/order.json`))
      ) {
        return dir;
      }
    }

    // 次优：目录本身存在
    for (const dir of candidates) {
      if (await adapter.exists(dir)) {
        return dir;
      }
    }

    // 其次：manifest.dir 存在则使用
    if (manifestDir && manifestDir.length > 0) {
      return manifestDir;
    }

    // 最后：默认回退到小写 id 目录
    return `.obsidian/plugins/${lowerId || "chinese-writer"}`;
  }

  private async readSettingsData(): Promise<Record<string, unknown>> {
    const adapter = this.app.vault.adapter;
    const settingsPath = `${this.pluginDir}/cw-setting.json`;
    const legacySettingsPath = `${this.pluginDir}/settings.json`;
    const legacyDataPath = `${this.pluginDir}/data.json`;

    try {
      if (await adapter.exists(settingsPath)) {
        const content = await adapter.read(settingsPath);
        const parsed = JSON.parse(content);
        return parsed && typeof parsed === "object" ? parsed : {};
      }

      if (await adapter.exists(legacySettingsPath)) {
        const content = await adapter.read(legacySettingsPath);
        const parsed = JSON.parse(content);
        return parsed && typeof parsed === "object" ? parsed : {};
      }

      if (await adapter.exists(legacyDataPath)) {
        const content = await adapter.read(legacyDataPath);
        const parsed = JSON.parse(content);
        return parsed && typeof parsed === "object" ? parsed : {};
      }
    } catch (error) {
      console.error("Failed to read settings data:", error);
    }

    return {};
  }

  /**
   * 按设置打开文件：
   * - 在当前标签页打开
   * - 或在新标签页打开
   * - 若文件已在某标签打开，则复用现有标签
   */
  async openFileWithSettings(
    file: TFile,
    options?: { revealWhenNewTab?: boolean }
  ): Promise<WorkspaceLeaf | null> {
    const openInNewTab = this.settings.openInNewTab;
    const revealWhenNewTab = options?.revealWhenNewTab ?? false;

    const existingLeaf = this.findOpenedLeafForFile(file.path);
    if (existingLeaf) {
      if (!openInNewTab || revealWhenNewTab) {
        this.app.workspace.revealLeaf(existingLeaf);
      }
      return existingLeaf;
    }

    if (!openInNewTab) {
      const targetLeaf = this.getPreferredCurrentLeaf();
      if (!targetLeaf) return null;
      await targetLeaf.openFile(file, { active: true });
      return targetLeaf;
    }

    const targetLeaf = this.app.workspace.getLeaf("tab");
    await targetLeaf.openFile(file, { active: revealWhenNewTab });
    return targetLeaf;
  }

  private getPreferredCurrentLeaf() {
    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeMarkdownView) {
      return activeMarkdownView.leaf;
    }

    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
    if (markdownLeaves.length > 0) {
      return markdownLeaves[0];
    }

    return this.app.workspace.getMostRecentLeaf();
  }

  private findOpenedLeafForFile(filePath: string) {
    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of markdownLeaves) {
      const viewState = leaf.getViewState();
      const stateFile = typeof viewState.state?.file === "string" ? viewState.state.file : null;
      if (stateFile === filePath) {
        return leaf;
      }

      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === filePath) {
        return leaf;
      }
    }
    return null;
  }

  private appendAddSettingEditorMenu(
    menu: { addSeparator: () => unknown; addItem: (cb: (item: any) => void) => unknown },
    editor: { getSelection: () => string },
    info: unknown
  ): void {
    const selectedTextRaw = editor.getSelection();
    const selectedText = selectedTextRaw.replace(/\s+/g, " ").trim();
    if (!selectedText) return;

    const file = (info as { file?: TFile | null } | null)?.file ?? this.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) return;

    const settingFolder = this.highlightManager.getSettingFolderForFile(file.path);
    if (!settingFolder) return;

    if (this.hasH3InSettingFolder(settingFolder, selectedText)) return;

    menu.addSeparator();
    menu.addItem((item: any) => {
      item.setTitle("添加设定");
      item.setIcon("book-plus");

      // 点击也可展开，避免不同平台下 hover 行为差异
      item.onClick((evt: MouseEvent) => {
        void this.openSettingFirstLevelMenu(evt.clientX, evt.clientY, settingFolder, selectedText, null);
      });

      const itemDom = item?.dom as HTMLElement | undefined;
      if (itemDom) {
        const arrowEl = itemDom.createSpan({ cls: "cw-context-submenu-arrow" });
        setIcon(arrowEl, "chevron-right");
        itemDom.addEventListener("mouseenter", () => {
          const rect = itemDom.getBoundingClientRect();
          void this.openSettingFirstLevelMenu(rect.right - 2, rect.top, settingFolder, selectedText, rect);
        });
        itemDom.addEventListener("mouseleave", () => this.scheduleCloseSettingSubmenus());
      }
    });
  }

  private async collectSettingFileOptions(settingFolder: string): Promise<Array<{
    file: TFile;
    h1Options: Array<{ label: string; lineNumber: number }>;
  }>> {
    const files = this.parser.getMarkdownFilesInFolder(settingFolder);
    const fileOrder = this.orderManager.getFileOrder();
    const orderedFiles = [...files].sort((a, b) => {
      const indexA = fileOrder.indexOf(a.path);
      const indexB = fileOrder.indexOf(b.path);
      if (indexA === -1 && indexB === -1) return a.path.localeCompare(b.path);
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });
    const results: Array<{ file: TFile; h1Options: Array<{ label: string; lineNumber: number }> }> = [];

    for (const file of orderedFiles) {
      const parsed = await this.parser.parseFile(file);
      if (!parsed) continue;
      const h1Options: Array<{ label: string; lineNumber: number }> = [];
      for (const h1 of parsed.h1List) {
        h1Options.push({ label: h1.text, lineNumber: h1.lineNumber });
      }
      results.push({ file, h1Options });
    }

    return results;
  }

  private async openSettingFirstLevelMenu(
    x: number,
    y: number,
    settingFolder: string,
    selectedText: string,
    anchorRect: DOMRect | null
  ): Promise<void> {
    this.clearCloseSettingSubmenusTimer();
    const fileOptions = await this.collectSettingFileOptions(settingFolder);
    if (fileOptions.length === 0) {
      this.closeSettingSubmenus();
      new Notice("该设定库没有可用的 H1 选项");
      return;
    }
    if (!this.settingMenuRootEl) {
      this.settingMenuRootEl = this.createSettingSubmenuContainer("cw-setting-submenu-root");
    }
    this.settingMenuRootEl.empty();
    this.settingMenuRootEl.removeClass("is-expand-left");
    this.settingMenuRootEl.removeClass("is-expand-right");
    const firstLevelArrows: Array<{ el: HTMLElement; hasChildren: boolean }> = [];

    for (const option of fileOptions) {
      const itemEl = this.settingMenuRootEl.createDiv({ cls: "cw-setting-submenu-item" });
      const iconEl = itemEl.createSpan({ cls: "cw-setting-submenu-item-icon" });
      setIcon(iconEl, "file-text");
      itemEl.createSpan({ text: option.file.basename, cls: "cw-setting-submenu-label" });

      const hasChildren = option.h1Options.length > 0;
      const arrowEl = itemEl.createSpan({ cls: "cw-setting-submenu-item-arrow" });
      setIcon(arrowEl, "chevron-right");
      firstLevelArrows.push({ el: arrowEl, hasChildren });
      if (!hasChildren) {
        itemEl.addClass("is-disabled");
      }

      itemEl.addEventListener("mouseenter", () => {
        this.clearCloseSettingSubmenusTimer();
        if (hasChildren) {
          const rect = itemEl.getBoundingClientRect();
          this.openSettingSecondLevelMenu(rect, option, selectedText);
        } else {
          this.closeSettingChildMenu();
        }
      });
      itemEl.addEventListener("mouseleave", () => this.scheduleCloseSettingSubmenus());
    }

    const preferredAnchor = anchorRect ?? this.createPointAnchorRect(x, y);
    this.settingMenuExpandDirection = this.pickMenuExpandDirection(this.settingMenuRootEl, preferredAnchor);
    const isExpandLeft = this.settingMenuExpandDirection === "left";
    this.settingMenuRootEl.toggleClass("is-expand-left", isExpandLeft);
    this.settingMenuRootEl.toggleClass("is-expand-right", !isExpandLeft);
    for (const arrow of firstLevelArrows) {
      if (!arrow.hasChildren) continue;
      arrow.el.empty();
      setIcon(arrow.el, isExpandLeft ? "chevron-left" : "chevron-right");
    }
    if (anchorRect) {
      this.placeMenuBesideAnchor(this.settingMenuRootEl, anchorRect, 2, this.settingMenuExpandDirection);
    } else {
      this.placeMenuBesideAnchor(this.settingMenuRootEl, preferredAnchor, 2, this.settingMenuExpandDirection);
    }
    this.settingMenuRootEl.style.display = "block";
  }

  private openSettingSecondLevelMenu(
    anchorRect: DOMRect,
    option: { file: TFile; h1Options: Array<{ label: string; lineNumber: number }> },
    selectedText: string
  ): void {
    this.clearCloseSettingSubmenusTimer();
    if (!this.settingMenuChildEl) {
      this.settingMenuChildEl = this.createSettingSubmenuContainer("cw-setting-submenu-child");
    }
    this.settingMenuChildEl.empty();

    for (const h1 of option.h1Options) {
      const itemEl = this.settingMenuChildEl.createDiv({ cls: "cw-setting-submenu-item" });
      const iconEl = itemEl.createSpan({ cls: "cw-setting-submenu-item-icon" });
      setIcon(iconEl, "heading-1");
      itemEl.createSpan({ text: h1.label, cls: "cw-setting-submenu-label" });
      itemEl.addEventListener("mouseenter", () => this.clearCloseSettingSubmenusTimer());
      itemEl.addEventListener("mouseleave", () => this.scheduleCloseSettingSubmenus());
      itemEl.addEventListener("click", () => {
        void this.appendSelectionAsH2(option.file, h1.lineNumber, selectedText);
      });
    }

    this.placeMenuBesideAnchor(this.settingMenuChildEl, anchorRect, 2, this.settingMenuExpandDirection);
    this.settingMenuChildEl.style.display = "block";
  }

  private async appendSelectionAsH2(file: TFile, h1LineNumber: number, selectedText: string): Promise<void> {
    const h2Text = selectedText.replace(/\s+/g, " ").trim();
    if (!h2Text) return;

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const safeH1Line = Math.max(0, Math.min(h1LineNumber, lines.length - 1));

    let insertIndex = lines.length;
    for (let i = safeH1Line + 1; i < lines.length; i++) {
      const trimmed = lines[i]?.trim() ?? "";
      if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
        insertIndex = i;
        break;
      }
    }

    lines.splice(insertIndex, 0, `## ${h2Text}`);

    await this.app.vault.modify(file, lines.join("\n"));
    this.updateH3CacheForSettingFile(file.path);
    this.highlightManager.clearCache();
    await this.smartUpdateView();
    new Notice(`已添加到：${file.basename}`);
    this.closeSettingSubmenus();
  }

  private placeMenuWithinViewport(menuEl: HTMLElement, preferredX: number, preferredY: number): void {
    menuEl.style.visibility = "hidden";
    menuEl.style.display = "block";
    menuEl.style.left = "0px";
    menuEl.style.top = "0px";
    const rect = menuEl.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(
      Math.max(margin, preferredX),
      Math.max(margin, window.innerWidth - rect.width - margin)
    );
    const top = Math.min(
      Math.max(margin, preferredY),
      Math.max(margin, window.innerHeight - rect.height - margin)
    );
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
    menuEl.style.visibility = "visible";
  }

  private placeMenuBesideAnchor(
    menuEl: HTMLElement,
    anchorRect: DOMRect,
    gap: number,
    direction: "right" | "left"
  ): void {
    menuEl.style.visibility = "hidden";
    menuEl.style.display = "block";
    menuEl.style.left = "0px";
    menuEl.style.top = "0px";
    const rect = menuEl.getBoundingClientRect();
    const margin = 8;

    let left = direction === "right"
      ? anchorRect.right + gap
      : anchorRect.left - rect.width - gap;
    if (left + rect.width > window.innerWidth - margin || left < margin) {
      left = direction === "right"
        ? anchorRect.left - rect.width - gap
        : anchorRect.right + gap;
    }
    if (left + rect.width > window.innerWidth - margin || left < margin) {
      left = anchorRect.left - rect.width - gap;
    }
    left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - rect.width - margin));

    let top = anchorRect.top;
    if (top + rect.height > window.innerHeight - margin) {
      top = window.innerHeight - rect.height - margin;
    }
    top = Math.max(margin, top);

    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
    menuEl.style.visibility = "visible";
  }

  private pickMenuExpandDirection(menuEl: HTMLElement, anchorRect: DOMRect): "right" | "left" {
    const margin = 8;
    const widthA = this.measureMenuWidth(menuEl);
    const widthB = this.measureMenuClassWidth("cw-setting-submenu cw-setting-submenu-child");
    const totalWidth = widthA + 2 + widthB;
    const rightSpace = window.innerWidth - anchorRect.right - margin;
    const leftSpace = anchorRect.left - margin;

    const canRight = rightSpace >= totalWidth;
    const canLeft = leftSpace >= totalWidth;
    if (canRight && canLeft) return "right";
    if (canRight) return "right";
    if (canLeft) return "left";
    return rightSpace >= leftSpace ? "right" : "left";
  }

  private measureMenuWidth(menuEl: HTMLElement): number {
    menuEl.style.visibility = "hidden";
    menuEl.style.display = "block";
    menuEl.style.left = "0px";
    menuEl.style.top = "0px";
    const width = menuEl.getBoundingClientRect().width;
    menuEl.style.display = "none";
    menuEl.style.visibility = "visible";
    return width;
  }

  private measureMenuClassWidth(className: string): number {
    const tempEl = document.body.createDiv({ cls: className });
    tempEl.style.visibility = "hidden";
    tempEl.style.display = "block";
    tempEl.style.left = "0px";
    tempEl.style.top = "0px";
    const width = tempEl.getBoundingClientRect().width;
    tempEl.remove();
    return width;
  }

  private createPointAnchorRect(x: number, y: number): DOMRect {
    return new DOMRect(x, y, 0, 0);
  }

  private createSettingSubmenuContainer(cls: string): HTMLElement {
    const menuEl = document.body.createDiv({ cls: `cw-setting-submenu ${cls}` });
    menuEl.addEventListener("mouseenter", () => this.clearCloseSettingSubmenusTimer());
    menuEl.addEventListener("mouseleave", () => this.scheduleCloseSettingSubmenus());
    return menuEl;
  }

  private closeSettingChildMenu(): void {
    if (this.settingMenuChildEl) {
      this.settingMenuChildEl.style.display = "none";
      this.settingMenuChildEl.empty();
    }
  }

  private closeSettingSubmenus(): void {
    this.clearCloseSettingSubmenusTimer();
    if (this.settingMenuRootEl) {
      this.settingMenuRootEl.remove();
      this.settingMenuRootEl = null;
    }
    if (this.settingMenuChildEl) {
      this.settingMenuChildEl.remove();
      this.settingMenuChildEl = null;
    }
  }

  private scheduleCloseSettingSubmenus(): void {
    this.clearCloseSettingSubmenusTimer();
    this.settingMenuCloseTimer = window.setTimeout(() => this.closeSettingSubmenus(), 180);
  }

  private clearCloseSettingSubmenusTimer(): void {
    if (this.settingMenuCloseTimer !== null) {
      window.clearTimeout(this.settingMenuCloseTimer);
      this.settingMenuCloseTimer = null;
    }
  }

  private async rebuildAllH3TitleCache(): Promise<void> {
    this.h3TitleCacheByFolder.clear();
    const folders = this.settings.folderMappings
      .map((mapping) => mapping.settingFolder)
      .filter((folder): folder is string => !!folder);
    await Promise.all(folders.map((folder) => this.rebuildH3TitleCacheForFolder(folder)));
  }

  private async rebuildH3TitleCacheForFolder(settingFolder: string): Promise<void> {
    const titleSet = new Set<string>();
    const files = this.parser.getMarkdownFilesInFolder(settingFolder);
    const contents = await Promise.all(files.map((file) => this.app.vault.read(file)));
    for (const content of contents) {
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        // 兼容右栏第三级设定标题：Markdown 的 "## "，
        // 同时保留对 "### " 标题的匹配，避免历史行为回退。
        const isH2Title = trimmed.startsWith("## ") && !trimmed.startsWith("### ");
        const isH3Title = trimmed.startsWith("### ") && !trimmed.startsWith("#### ");
        if (isH2Title || isH3Title) {
          const levelPrefixLength = isH2Title ? 3 : 4;
          const title = trimmed.slice(levelPrefixLength).replace(/\s+/g, " ").trim();
          if (title) titleSet.add(title);
        }
      }
    }
    this.h3TitleCacheByFolder.set(settingFolder, titleSet);
  }

  private hasH3InSettingFolder(settingFolder: string, selectedText: string): boolean {
    const cachedTitles = this.h3TitleCacheByFolder.get(settingFolder);
    if (!cachedTitles) return false;
    const normalizedSelection = selectedText.replace(/\s+/g, " ").trim();
    return cachedTitles.has(normalizedSelection);
  }

  private updateH3CacheForSettingFile(filePath: string): void {
    const settingFolder = this.findSettingFolderByFilePath(filePath);
    if (!settingFolder) return;
    void this.rebuildH3TitleCacheForFolder(settingFolder);
  }

  private findSettingFolderByFilePath(filePath: string): string | null {
    for (const mapping of this.settings.folderMappings) {
      if (mapping.settingFolder && filePath.startsWith(`${mapping.settingFolder}/`)) {
        return mapping.settingFolder;
      }
    }
    return null;
  }

  /**
   * 文件创建时同步 order.json
   */
  private async syncOrderOnFileCreate(file: TFile): Promise<void> {
    // 检查文件是否在任何设定库中
    let folderPath: string | null = null;
    for (const mapping of this.settings.folderMappings) {
      if (mapping.settingFolder && file.path.startsWith(mapping.settingFolder + "/")) {
        folderPath = mapping.settingFolder;
        break;
      }
    }

    if (!folderPath) {
      await this.smartUpdateView();
      return;
    }

    let fileOrder = this.orderManager.getFileOrder();

    // 如果 order.json 为空，获取目录下所有现有文件
    if (fileOrder.length === 0) {
      const files = this.parser.getMarkdownFilesInFolder(folderPath);
      fileOrder = files.map(f => f.path);
    } else if (!fileOrder.includes(file.path)) {
      // 如果文件不在 order.json 中，添加到末尾
      fileOrder.push(file.path);
    }

    await this.orderManager.setFileOrder(fileOrder);

    // 延迟刷新视图
    setTimeout(() => {
      this.smartUpdateView();
    }, 400);
  }

  /**
   * 文件删除时同步 order.json
   */
  private async syncOrderOnFileDelete(file: TFile): Promise<void> {
    // 检查文件是否在任何设定库中
    let folderPath: string | null = null;
    for (const mapping of this.settings.folderMappings) {
      if (mapping.settingFolder && file.path.startsWith(mapping.settingFolder + "/")) {
        folderPath = mapping.settingFolder;
        break;
      }
    }

    if (!folderPath) {
      await this.smartUpdateView();
      return;
    }

    let fileOrder = this.orderManager.getFileOrder();

    // 如果 order.json 为空，获取目录下所有现有文件（删除前）
    if (fileOrder.length === 0) {
      const files = this.parser.getMarkdownFilesInFolder(folderPath);
      fileOrder = files.map(f => f.path);
    }

    // 从 order.json 中移除该文件
    const index = fileOrder.indexOf(file.path);
    if (index !== -1) {
      fileOrder.splice(index, 1);
      await this.orderManager.setFileOrder(fileOrder);
    }

    // 延迟刷新视图
    setTimeout(() => {
      this.smartUpdateView();
    }, 400);
  }

  /**
   * 文件重命名时同步 order.json
   */
  private async syncOrderOnFileRename(file: TFile, oldPath: string): Promise<void> {
    // 检查文件是否在任何设定库中
    let folderPath: string | null = null;
    let wasInFolder = false;
    let isInFolder = false;

    for (const mapping of this.settings.folderMappings) {
      if (mapping.settingFolder) {
        if (oldPath.startsWith(mapping.settingFolder + "/")) {
          wasInFolder = true;
          folderPath = mapping.settingFolder;
        }
        if (file.path.startsWith(mapping.settingFolder + "/")) {
          isInFolder = true;
          folderPath = mapping.settingFolder;
        }
      }
    }

    if (!wasInFolder && !isInFolder) {
      await this.smartUpdateView();
      return;
    }

    if (!folderPath) {
      await this.smartUpdateView();
      return;
    }

    let fileOrder = this.orderManager.getFileOrder();

    // 如果 order.json 为空，获取目录下所有现有文件
    if (fileOrder.length === 0) {
      const files = this.parser.getMarkdownFilesInFolder(folderPath);
      fileOrder = files.map(f => f.path);
    } else {
      // 更新 order.json 中的文件路径
      const index = fileOrder.indexOf(oldPath);
      if (index !== -1) {
        if (isInFolder) {
          // 文件仍在文件夹内，更新路径
          fileOrder[index] = file.path;
        } else {
          // 文件被移出文件夹，移除
          fileOrder.splice(index, 1);
        }
      } else if (isInFolder) {
        // 文件被移入文件夹，添加
        fileOrder.push(file.path);
      }
    }

    await this.orderManager.setFileOrder(fileOrder);

    // 延迟刷新视图
    setTimeout(() => {
      this.smartUpdateView();
    }, 400);
  }
}
