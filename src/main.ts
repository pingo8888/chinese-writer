import { Plugin, TFile, MarkdownView } from "obsidian";
import { ChineseWriterSettings, DEFAULT_SETTINGS, ChineseWriterSettingTab } from "./settings";
import { FileParser } from "./parser";
import { TreeView, VIEW_TYPE_TREE } from "./tree-view";
import { OrderManager } from "./order-manager";
import { HighlightManager } from "./highlight-manager";

/**
 * 中文写作插件主类
 */
export default class ChineseWriterPlugin extends Plugin {
  settings: ChineseWriterSettings;
  parser: FileParser;
  orderManager: OrderManager;
  highlightManager: HighlightManager;

  async onload() {
    // 加载设置
    await this.loadSettings();

    // 初始化解析器
    this.parser = new FileParser(this.app.vault);

    // 初始化排序管理器
    this.orderManager = new OrderManager(this.app, this.manifest.dir || "");
    await this.orderManager.load();

    // 初始化高亮管理器
    this.highlightManager = new HighlightManager(this);

    // 注册编辑器扩展（关键字高亮）
    this.registerEditorExtension(this.highlightManager.createEditorExtension());

    // 初始化高亮样式
    this.highlightManager.updateStyles();

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

    // 添加功能区图标
    this.addRibbonIcon("book-open", "中文写作", () => {
      this.activateView();
    });

    // 添加设置面板
    this.addSettingTab(new ChineseWriterSettingTab(this.app, this));

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
          this.smartUpdateView();

          // 如果修改的是设定库中的文件，清除关键字缓存并刷新编辑器
          for (const mapping of this.settings.folderMappings) {
            if (mapping.settingFolder && file.path.startsWith(mapping.settingFolder + "/")) {
              this.highlightManager.clearCache();
              // 触发编辑器重新渲染以更新高亮
              // 延迟执行以确保文件修改完成
              setTimeout(() => {
                this.app.workspace.updateOptions();
                // 强制刷新当前活动的编辑器视图
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView && activeView.editor) {
                  activeView.editor.refresh();
                }
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
          this.syncOrderOnFileCreate(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        // 当文件被删除时，同步 order.json 并更新视图
        if (file instanceof TFile && file.extension === "md") {
          this.syncOrderOnFileDelete(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        // 当文件被重命名时，同步 order.json 并更新视图
        if (file instanceof TFile && file.extension === "md") {
          this.syncOrderOnFileRename(file, oldPath);
        }
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
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

    // 确保 highlightStyle 的所有字段都有默认值（兼容旧版本）
    if (this.settings.highlightStyle) {
      this.settings.highlightStyle = Object.assign(
        {},
        DEFAULT_SETTINGS.highlightStyle,
        this.settings.highlightStyle
      );
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
    await this.saveData(this.settings);
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
