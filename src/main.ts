import { Plugin, TFile } from "obsidian";
import { ChineseWriterSettings, DEFAULT_SETTINGS, ChineseWriterSettingTab } from "./settings";
import { FileParser } from "./parser";
import { TreeView, VIEW_TYPE_TREE } from "./tree-view";
import { OrderManager } from "./order-manager";

/**
 * 中文写作插件主类
 */
export default class ChineseWriterPlugin extends Plugin {
  settings: ChineseWriterSettings;
  parser: FileParser;
  orderManager: OrderManager;

  async onload() {
    // 加载设置
    await this.loadSettings();

    // 初始化解析器
    this.parser = new FileParser(this.app.vault);

    // 初始化排序管理器
    this.orderManager = new OrderManager(this.app, this.manifest.dir || "");
    await this.orderManager.load();

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

    // 监听文件变化事件
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        // 当文件被修改时，智能更新视图（保持展开状态）
        if (file instanceof TFile && file.extension === "md") {
          this.smartUpdateView();
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
    const folderPath = this.settings.targetFolder;
    if (!folderPath) {
      await this.smartUpdateView();
      return;
    }

    // 检查文件是否在目标文件夹内
    if (!file.path.startsWith(folderPath + "/")) {
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
    const folderPath = this.settings.targetFolder;
    if (!folderPath) {
      await this.smartUpdateView();
      return;
    }

    // 检查文件是否在目标文件夹内
    if (!file.path.startsWith(folderPath + "/")) {
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
    const folderPath = this.settings.targetFolder;
    if (!folderPath) {
      await this.smartUpdateView();
      return;
    }

    // 检查文件是否在目标文件夹内
    const wasInFolder = oldPath.startsWith(folderPath + "/");
    const isInFolder = file.path.startsWith(folderPath + "/");

    if (!wasInFolder && !isInFolder) {
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
