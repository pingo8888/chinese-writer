import { App, TFile } from "obsidian";
import type { OrderData, H1Info, H2Info } from "./types";

/**
 * 排序管理器
 */
export class OrderManager {
  private app: App;
  private viewDataFilePath: string;
  private legacyViewDataFilePath: string;
  private legacyOrderFilePath: string;
  private orderData: OrderData;
  private saveTimeout: NodeJS.Timeout | null = null;
  private isSaving: boolean = false;

  constructor(app: App, pluginDir: string) {
    this.app = app;
    this.viewDataFilePath = `${pluginDir}/cw-view-datas.json`;
    this.legacyViewDataFilePath = `${pluginDir}/view-datas.json`;
    this.legacyOrderFilePath = `${pluginDir}/order.json`;
    this.orderData = {
      files: [],
      expandedStatesByFolder: {},
    };
  }

  /**
   * 加载排序数据
   */
  async load(): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      const hasViewDataFile = await adapter.exists(this.viewDataFilePath);
      const hasLegacyViewDataFile = await adapter.exists(this.legacyViewDataFilePath);
      const hasLegacyOrderFile = await adapter.exists(this.legacyOrderFilePath);
      let targetPath = this.viewDataFilePath;

      if (!hasViewDataFile && hasLegacyViewDataFile) {
        targetPath = this.legacyViewDataFilePath;
      } else if (!hasViewDataFile && hasLegacyOrderFile) {
        targetPath = this.legacyOrderFilePath;
      }

      const exists = await adapter.exists(targetPath);
      if (!exists) {
        this.orderData = { files: [], expandedStatesByFolder: {} };
        return;
      }

      const content = await adapter.read(targetPath);
      const parsed = JSON.parse(content) as Partial<OrderData> | null;
      const files = Array.isArray(parsed?.files)
        ? parsed!.files.filter((item): item is string => typeof item === "string" && item.length > 0)
        : [];
      const expandedStatesByFolder: Record<string, Record<string, boolean>> = {};
      if (parsed?.expandedStatesByFolder && typeof parsed.expandedStatesByFolder === "object") {
        for (const [folder, folderStates] of Object.entries(parsed.expandedStatesByFolder)) {
          if (!folderStates || typeof folderStates !== "object") continue;
          const filteredStates: Record<string, boolean> = {};
          for (const [key, value] of Object.entries(folderStates as Record<string, unknown>)) {
            if (typeof value !== "boolean") continue;
            // H2 没有展开/折叠按钮，不保留其状态
            if (key.includes(">>h2:")) continue;
            filteredStates[key] = value;
          }
          expandedStatesByFolder[folder] = filteredStates;
        }
      }

      this.orderData = { files, expandedStatesByFolder };

      // 兼容迁移：若读取的是旧文件，写回新 cw-view-datas.json
      if (targetPath === this.legacyOrderFilePath && !hasViewDataFile) {
        await this.saveNow();
      }
      if (targetPath === this.legacyViewDataFilePath && !hasViewDataFile) {
        await this.saveNow();
      }
    } catch (error) {
      // 文件不存在或解析失败，使用默认值
      this.orderData = {
        files: [],
        expandedStatesByFolder: {},
      };
    }
  }

  /**
   * 保存排序数据（带防抖）
   */
  async save(): Promise<void> {
    // 清除之前的定时器
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    // 延迟保存，避免频繁写入
    return new Promise((resolve) => {
      this.saveTimeout = setTimeout(async () => {
        await this.saveNow();
        resolve();
      }, 300); // 300ms 防抖
    });
  }

  /**
   * 立即保存排序数据
   */
  private async saveNow(): Promise<void> {
    // 如果正在保存，等待完成
    if (this.isSaving) {
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.saveNow();
    }

    this.isSaving = true;

    try {
      const content = JSON.stringify(this.orderData, null, 2);

      // 使用 adapter 直接写入，更可靠
      const adapter = this.app.vault.adapter;
      const exists = await adapter.exists(this.viewDataFilePath);

      if (exists) {
        await adapter.write(this.viewDataFilePath, content);
      } else {
        // 确保父目录存在
        const parentDir = this.viewDataFilePath.substring(0, this.viewDataFilePath.lastIndexOf('/'));
        if (parentDir && !(await adapter.exists(parentDir))) {
          await adapter.mkdir(parentDir);
        }
        await adapter.write(this.viewDataFilePath, content);
      }
    } catch (error) {
      console.error("Failed to save order data:", error);
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * 获取文件排序
   */
  getFileOrder(): string[] {
    return this.orderData.files;
  }

  /**
   * 设置文件排序
   */
  async setFileOrder(filePaths: string[]): Promise<void> {
    this.orderData.files = filePaths;
    await this.save();
  }

  getExpandedStates(settingFolder: string): Record<string, boolean> {
    return this.orderData.expandedStatesByFolder[settingFolder] ?? {};
  }

  async setExpandedStates(settingFolder: string, states: Record<string, boolean>): Promise<void> {
    this.orderData.expandedStatesByFolder[settingFolder] = states;
    await this.save();
  }

  async removeFolderData(settingFolder: string): Promise<void> {
    if (this.orderData.expandedStatesByFolder[settingFolder]) {
      delete this.orderData.expandedStatesByFolder[settingFolder];
    }
    await this.save();
  }

  /**
   * 重新排序文件中的 H1（直接修改文件）
   */
  async reorderH1InFile(filePath: string, h1Order: string[]): Promise<void> {
    // console.log("reorderH1InFile called:", { filePath, h1Order });
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      // console.log("File not found:", filePath);
      return;
    }

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    // 解析所有 H1 块
    const h1Blocks: Map<string, string[]> = new Map();
    let currentH1: string | null = null;
    let currentBlock: string[] = [];
    let beforeFirstH1: string[] = [];
    let inFirstH1 = true;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
        // 遇到新的 H1
        if (currentH1) {
          h1Blocks.set(currentH1, currentBlock);
        } else if (inFirstH1) {
          beforeFirstH1 = currentBlock;
          inFirstH1 = false;
        }

        currentH1 = trimmed.substring(2).trim();
        currentBlock = [line];
      } else {
        currentBlock.push(line);
      }
    }

    // 保存最后一个 H1 块
    if (currentH1) {
      h1Blocks.set(currentH1, currentBlock);
    }

    // console.log("Parsed H1 blocks:", Array.from(h1Blocks.keys()));

    // 按照新顺序重组内容
    const newLines: string[] = [...beforeFirstH1];

    for (const h1Text of h1Order) {
      const block = h1Blocks.get(h1Text);
      if (block) {
        newLines.push(...block);
      } else {
        // console.log("H1 block not found:", h1Text);
      }
    }

    // 写回文件
    const newContent = newLines.join("\n");
    // console.log("Writing reordered content, lines:", newLines.length);
    await this.app.vault.modify(file, newContent);
    // console.log("reorderH1InFile completed");
  }

  /**
   * 重新排序文件中某个 H1 下的 H2（直接修改文件）
   */
  async reorderH2InFile(filePath: string, h1Text: string, h2Order: string[]): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    // 找到目标 H1 的范围
    let h1StartIndex = -1;
    let h1EndIndex = lines.length;
    let foundH1 = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const trimmed = line.trim();

      if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
        const currentH1Text = trimmed.substring(2).trim();

        if (currentH1Text === h1Text) {
          h1StartIndex = i;
          foundH1 = true;
        } else if (foundH1) {
          h1EndIndex = i;
          break;
        }
      }
    }

    if (h1StartIndex === -1) return;

    // 解析该 H1 下的所有 H2 块
    const h2Blocks: Map<string, string[]> = new Map();
    let currentH2: string | null = null;
    let currentBlock: string[] = [];
    let beforeFirstH2: string[] = [];
    let inFirstH2 = true;

    for (let i = h1StartIndex; i < h1EndIndex; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const trimmed = line.trim();

      if (i === h1StartIndex) {
        // H1 行本身
        beforeFirstH2.push(line);
        continue;
      }

      if (trimmed.startsWith("## ") && !trimmed.startsWith("### ")) {
        // 遇到新的 H2
        if (currentH2) {
          h2Blocks.set(currentH2, currentBlock);
        } else if (inFirstH2) {
          beforeFirstH2.push(...currentBlock);
          inFirstH2 = false;
        }

        currentH2 = trimmed.substring(3).trim();
        currentBlock = [line];
      } else {
        currentBlock.push(line);
      }
    }

    // 保存最后一个 H2 块
    if (currentH2) {
      h2Blocks.set(currentH2, currentBlock);
    } else if (currentBlock.length > 0) {
      beforeFirstH2.push(...currentBlock);
    }

    // 按照新顺序重组该 H1 的内容
    const newH1Content: string[] = [...beforeFirstH2];

    for (const h2Text of h2Order) {
      const block = h2Blocks.get(h2Text);
      if (block) {
        newH1Content.push(...block);
      }
    }

    // 重组整个文件
    const newLines = [
      ...lines.slice(0, h1StartIndex),
      ...newH1Content,
      ...lines.slice(h1EndIndex),
    ];

    // 写回文件
    const newContent = newLines.join("\n");
    await this.app.vault.modify(file, newContent);
  }

  /**
   * 跨文件移动 H1
   */
  async moveH1BetweenFiles(
    sourceFilePath: string,
    targetFilePath: string,
    h1Text: string,
    targetH1Text: string,
    insertBefore: boolean = false
  ): Promise<void> {
    // console.log("moveH1BetweenFiles:", { sourceFilePath, targetFilePath, h1Text, targetH1Text, insertBefore });

    // 从源文件读取 H1 内容
    const sourceFile = this.app.vault.getAbstractFileByPath(sourceFilePath);
    if (!(sourceFile instanceof TFile)) return;

    const sourceContent = await this.app.vault.read(sourceFile);
    const sourceLines = sourceContent.split("\n");

    // 提取要移动的 H1 块
    let h1Block: string[] = [];
    let h1Found = false;
    let inTargetH1 = false;

    for (const line of sourceLines) {
      const trimmed = line.trim();

      if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
        const currentH1 = trimmed.substring(2).trim();

        if (currentH1 === h1Text) {
          inTargetH1 = true;
          h1Found = true;
          h1Block.push(line);
        } else if (inTargetH1) {
          // 遇到下一个 H1，停止收集
          break;
        }
      } else if (inTargetH1) {
        h1Block.push(line);
      }
    }

    if (!h1Found) {
      // console.log("H1 not found in source file");
      return;
    }

    // 从源文件删除 H1
    const newSourceLines = sourceLines.filter((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
        const currentH1 = trimmed.substring(2).trim();
        if (currentH1 === h1Text) {
          return false;
        }
      }
      // 检查是否在要删除的 H1 块中
      const lineContent = line;
      return !h1Block.includes(lineContent);
    });

    await this.app.vault.modify(sourceFile, newSourceLines.join("\n"));

    // 插入到目标文件
    const targetFile = this.app.vault.getAbstractFileByPath(targetFilePath);
    if (!(targetFile instanceof TFile)) return;

    const targetContent = await this.app.vault.read(targetFile);
    const targetLines = targetContent.split("\n");

    // 找到目标 H1 的位置
    let insertIndex = targetLines.length;
    for (let i = 0; i < targetLines.length; i++) {
      const line = targetLines[i];
      if (!line) continue;
      const trimmed = line.trim();
      if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
        const currentH1 = trimmed.substring(2).trim();
        if (currentH1 === targetH1Text) {
          if (insertBefore) {
            // 插入到目标 H1 之前
            insertIndex = i;
          } else {
            // 插入到目标 H1 之后，找到下一个 H1 的位置
            for (let j = i + 1; j < targetLines.length; j++) {
              const nextLine = targetLines[j];
              if (!nextLine) continue;
              const nextTrimmed = nextLine.trim();
              if (nextTrimmed.startsWith("# ") && !nextTrimmed.startsWith("## ")) {
                insertIndex = j;
                break;
              }
            }
          }
          break;
        }
      }
    }

    // 插入 H1 块
    const newTargetLines = [
      ...targetLines.slice(0, insertIndex),
      ...h1Block,
      ...targetLines.slice(insertIndex),
    ];

    await this.app.vault.modify(targetFile, newTargetLines.join("\n"));

    // console.log("moveH1BetweenFiles completed");
  }

  /**
   * 将 H1 移动到目标文件末尾（跨文件）
   */
  async moveH1ToEndOfFile(
    sourceFilePath: string,
    targetFilePath: string,
    h1Text: string
  ): Promise<void> {
    // 源目标相同文件，不做操作
    if (sourceFilePath === targetFilePath) return;

    const sourceFile = this.app.vault.getAbstractFileByPath(sourceFilePath);
    if (!(sourceFile instanceof TFile)) return;

    const sourceContent = await this.app.vault.read(sourceFile);
    const sourceLines = sourceContent.split("\n");

    // 提取要移动的 H1 块
    const h1Block: string[] = [];
    let inTargetH1 = false;

    for (const line of sourceLines) {
      const trimmed = line.trim();

      if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
        const currentH1 = trimmed.substring(2).trim();
        if (currentH1 === h1Text) {
          inTargetH1 = true;
          h1Block.push(line);
          continue;
        }
        if (inTargetH1) {
          break;
        }
      }

      if (inTargetH1) {
        h1Block.push(line);
      }
    }

    if (h1Block.length === 0) return;

    // 从源文件中删除该 H1 块
    const newSourceLines: string[] = [];
    inTargetH1 = false;

    for (const line of sourceLines) {
      const trimmed = line.trim();

      if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
        const currentH1 = trimmed.substring(2).trim();
        if (currentH1 === h1Text) {
          inTargetH1 = true;
          continue;
        }
        if (inTargetH1) {
          inTargetH1 = false;
        }
      }

      if (!inTargetH1) {
        newSourceLines.push(line);
      }
    }

    await this.app.vault.modify(sourceFile, newSourceLines.join("\n"));

    // 追加到目标文件末尾
    const targetFile = this.app.vault.getAbstractFileByPath(targetFilePath);
    if (!(targetFile instanceof TFile)) return;

    const targetContent = await this.app.vault.read(targetFile);
    const targetLines = targetContent.split("\n");
    const newTargetLines = [...targetLines, ...h1Block];

    await this.app.vault.modify(targetFile, newTargetLines.join("\n"));
  }

  /**
   * 将 H2 移动到指定 H1 的末尾（跨 H1 或跨文件）
   */
  async moveH2ToEndOfH1(
    sourceFilePath: string,
    sourceH1Text: string,
    targetFilePath: string,
    targetH1Text: string,
    h2Text: string
  ): Promise<void> {
    const sourceFile = this.app.vault.getAbstractFileByPath(sourceFilePath);
    if (!(sourceFile instanceof TFile)) return;

    const sourceContent = await this.app.vault.read(sourceFile);
    const sourceLines = sourceContent.split("\n");

    // 提取要移动的 H2 块
    const h2Block: string[] = [];
    let inTargetH1 = false;
    let inTargetH2 = false;

    for (const line of sourceLines) {
      const trimmed = line.trim();

      if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
        const currentH1 = trimmed.substring(2).trim();
        inTargetH1 = (currentH1 === sourceH1Text);
        if (!inTargetH1 && inTargetH2) break;
        if (!inTargetH1) inTargetH2 = false;
      } else if (inTargetH1 && trimmed.startsWith("## ") && !trimmed.startsWith("### ")) {
        const currentH2 = trimmed.substring(3).trim();
        if (currentH2 === h2Text) {
          inTargetH2 = true;
          h2Block.push(line);
        } else if (inTargetH2) {
          break;
        }
      } else if (inTargetH2) {
        h2Block.push(line);
      }
    }

    if (h2Block.length === 0) return;

    // 若源和目标相同 H1，不做任何操作
    if (sourceFilePath === targetFilePath && sourceH1Text === targetH1Text) return;

    // 从源文件删除 H2
    await this.removeH2FromFile(sourceFilePath, sourceH1Text, h2Text);

    // 插入到目标 H1 末尾
    const targetFile = this.app.vault.getAbstractFileByPath(targetFilePath);
    if (!(targetFile instanceof TFile)) return;

    const targetContent = await this.app.vault.read(targetFile);
    const targetLines = targetContent.split("\n");

    // 找到目标 H1 的末尾位置（下一个 H1 之前，或文件末尾）
    let insertIndex = targetLines.length;
    let inTarget = false;

    for (let i = 0; i < targetLines.length; i++) {
      const line = targetLines[i];
      if (!line) continue;
      const trimmed = line.trim();

      if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
        const currentH1 = trimmed.substring(2).trim();
        if (currentH1 === targetH1Text) {
          inTarget = true;
        } else if (inTarget) {
          insertIndex = i;
          break;
        }
      }
    }

    const newLines = [
      ...targetLines.slice(0, insertIndex),
      ...h2Block,
      ...targetLines.slice(insertIndex),
    ];

    await this.app.vault.modify(targetFile, newLines.join("\n"));
  }

  /**
   * 跨 H1 或跨文件移动 H2
   */
  async moveH2BetweenH1s(
    sourceFilePath: string,
    sourceH1Text: string,
    targetFilePath: string,
    targetH1Text: string,
    h2Text: string,
    targetH2Text: string,
    insertBefore: boolean = false
  ): Promise<void> {
    // console.log("moveH2BetweenH1s:", {
    //   sourceFilePath, sourceH1Text,
    //   targetFilePath, targetH1Text,
    //   h2Text, targetH2Text,
    //   insertBefore
    // });

    // 从源位置读取 H2 内容
    const sourceFile = this.app.vault.getAbstractFileByPath(sourceFilePath);
    if (!(sourceFile instanceof TFile)) return;

    const sourceContent = await this.app.vault.read(sourceFile);
    const sourceLines = sourceContent.split("\n");

    // 提取要移动的 H2 块
    let h2Block: string[] = [];
    let inTargetH1 = false;
    let inTargetH2 = false;

    for (const line of sourceLines) {
      const trimmed = line.trim();

      if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
        const currentH1 = trimmed.substring(2).trim();
        inTargetH1 = (currentH1 === sourceH1Text);
        if (!inTargetH1 && inTargetH2) break;
      } else if (inTargetH1 && trimmed.startsWith("## ") && !trimmed.startsWith("### ")) {
        const currentH2 = trimmed.substring(3).trim();
        if (currentH2 === h2Text) {
          inTargetH2 = true;
          h2Block.push(line);
        } else if (inTargetH2) {
          break;
        }
      } else if (inTargetH2) {
        h2Block.push(line);
      }
    }

    if (h2Block.length === 0) {
      // console.log("H2 not found in source");
      return;
    }

    // 从源文件删除 H2（使用更精确的方法）
    await this.removeH2FromFile(sourceFilePath, sourceH1Text, h2Text);

    // 插入到目标位置
    await this.insertH2ToFile(targetFilePath, targetH1Text, targetH2Text, h2Block, insertBefore);

    // console.log("moveH2BetweenH1s completed");
  }

  /**
   * 从文件中删除 H2
   */
  private async removeH2FromFile(filePath: string, h1Text: string, h2Text: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    const newLines: string[] = [];
    let inTargetH1 = false;
    let inTargetH2 = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
        const currentH1 = trimmed.substring(2).trim();
        inTargetH1 = (currentH1 === h1Text);
        inTargetH2 = false;
        newLines.push(line);
      } else if (inTargetH1 && trimmed.startsWith("## ") && !trimmed.startsWith("### ")) {
        const currentH2 = trimmed.substring(3).trim();
        if (currentH2 === h2Text) {
          inTargetH2 = true;
          // 不添加这行，开始删除
        } else {
          inTargetH2 = false;
          newLines.push(line);
        }
      } else if (!inTargetH2) {
        newLines.push(line);
      }
      // inTargetH2 为 true 时，跳过该行（删除）
    }

    await this.app.vault.modify(file, newLines.join("\n"));
  }

  /**
   * 插入 H2 到文件
   */
  private async insertH2ToFile(
    filePath: string,
    h1Text: string,
    targetH2Text: string,
    h2Block: string[],
    insertBefore: boolean = false
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    let insertIndex = lines.length;
    let inTargetH1 = false;
    let foundTargetH2 = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const trimmed = line.trim();

      if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
        const currentH1 = trimmed.substring(2).trim();
        if (currentH1 === h1Text) {
          inTargetH1 = true;
        } else if (inTargetH1) {
          // 遇到下一个 H1，在这里插入
          insertIndex = i;
          break;
        }
      } else if (inTargetH1 && trimmed.startsWith("## ") && !trimmed.startsWith("### ")) {
        const currentH2 = trimmed.substring(3).trim();
        if (currentH2 === targetH2Text) {
          foundTargetH2 = true;

          if (insertBefore) {
            // 插入到目标 H2 之前
            insertIndex = i;
            break;
          } else {
            // 插入到目标 H2 之后，找到它的结束位置
            for (let j = i + 1; j < lines.length; j++) {
              const nextLine = lines[j];
              if (!nextLine) continue;
              const nextTrimmed = nextLine.trim();
              if (nextTrimmed.startsWith("## ") && !nextTrimmed.startsWith("### ")) {
                insertIndex = j;
                break;
              } else if (nextTrimmed.startsWith("# ") && !nextTrimmed.startsWith("## ")) {
                insertIndex = j;
                break;
              }
            }
            break;
          }
        }
      }
    }

    const newLines = [
      ...lines.slice(0, insertIndex),
      ...h2Block,
      ...lines.slice(insertIndex),
    ];

    await this.app.vault.modify(file, newLines.join("\n"));
  }

}
