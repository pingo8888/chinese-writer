import { TFile, Vault } from "obsidian";
import type { FileParseResult, H1Info, H2Info } from "./types";

/**
 * 文件解析器
 */
export class FileParser {
  private vault: Vault;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  /**
   * 解析指定文件夹下的所有 Markdown 文件
   * @param folderPath 文件夹路径
   * @returns 解析结果数组
   */
  async parseFolder(folderPath: string): Promise<FileParseResult[]> {
    const results: FileParseResult[] = [];

    // 获取文件夹
    const folder = this.vault.getAbstractFileByPath(folderPath);
    if (!folder || !(folder instanceof TFile)) {
      // 如果不是文件，尝试作为文件夹处理
      const allFiles = this.vault.getMarkdownFiles();
      const filesInFolder = allFiles.filter((file) =>
        file.path.startsWith(folderPath)
      );

      for (const file of filesInFolder) {
        const result = await this.parseFile(file);
        if (result) {
          results.push(result);
        }
      }
    }

    return results;
  }

  /**
   * 解析单个 Markdown 文件
   * @param file 文件对象
   * @returns 解析结果
   */
  async parseFile(file: TFile): Promise<FileParseResult | null> {
    if (file.extension !== "md") {
      return null;
    }

    const content = await this.vault.read(file);
    const lines = content.split("\n");

    const h1List: H1Info[] = [];
    let currentH1: H1Info | null = null;
    let currentH2: H2Info | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const trimmedLine = line.trim();

      // 检测 H1
      if (trimmedLine.startsWith("# ") && !trimmedLine.startsWith("## ")) {
        // 保存之前的 H2
        if (currentH2 && currentH1) {
          currentH1.h2List.push(currentH2);
          currentH2 = null;
        }

        // 保存之前的 H1
        if (currentH1) {
          h1List.push(currentH1);
        }

        // 创建新的 H1
        currentH1 = {
          text: trimmedLine.substring(2).trim(),
          lineNumber: i,
          h2List: [],
        };
      }
      // 检测 H2（只有在 H1 存在时才处理）
      else if (
        trimmedLine.startsWith("## ") &&
        !trimmedLine.startsWith("### ") &&
        currentH1
      ) {
        // 保存之前的 H2
        if (currentH2) {
          currentH1.h2List.push(currentH2);
        }

        // 创建新的 H2
        currentH2 = {
          text: trimmedLine.substring(3).trim(),
          lineNumber: i,
          content: [],
        };
      }
      // 收集 H2 下的内容
      else if (currentH2 && line && trimmedLine.length > 0) {
        // 只收集非空行
        currentH2.content.push(line);
      }
    }

    // 保存最后的 H2
    if (currentH2 && currentH1) {
      currentH1.h2List.push(currentH2);
    }

    // 保存最后的 H1
    if (currentH1) {
      h1List.push(currentH1);
    }

    return {
      filePath: file.path,
      fileName: file.basename,
      h1List,
    };
  }

  /**
   * 获取指定文件夹下的所有 Markdown 文件
   * @param folderPath 文件夹路径
   * @returns Markdown 文件数组
   */
  getMarkdownFilesInFolder(folderPath: string): TFile[] {
    const allFiles = this.vault.getMarkdownFiles();
    return allFiles.filter((file) => {
      // 确保文件在指定文件夹内
      if (folderPath === "") {
        return true;
      }
      return file.path.startsWith(folderPath + "/") || file.path === folderPath;
    });
  }
}
