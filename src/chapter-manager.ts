import { Notice, TFile, WorkspaceLeaf } from "obsidian";
import type ChineseWriterPlugin from "./main";

/**
 * 章节创建管理器
 */
export class ChapterManager {
  private plugin: ChineseWriterPlugin;

  constructor(plugin: ChineseWriterPlugin) {
    this.plugin = plugin;
  }

  async createNextChapterFromActiveFile(): Promise<void> {
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile) || activeFile.extension !== "md") {
      new Notice("请先打开一个章节文件");
      return;
    }

    const currentDir = this.getParentDirPath(activeFile.path);
    const siblingMarkdownFiles = this.getDirectMarkdownSiblings(currentDir);

    let maxChapterNumber = 0;
    for (const file of siblingMarkdownFiles) {
      const chapterNumber = this.extractChapterNumber(file.basename);
      if (chapterNumber !== null && chapterNumber > maxChapterNumber) {
        maxChapterNumber = chapterNumber;
      }
    }

    const nextChapterNumber = maxChapterNumber + 1;
    const newFileBaseName = `第${nextChapterNumber}章 `;
    const newFilePath = currentDir ? `${currentDir}/${newFileBaseName}.md` : `${newFileBaseName}.md`;

    if (this.plugin.app.vault.getAbstractFileByPath(newFilePath)) {
      new Notice(`章节已存在：${newFileBaseName}`);
      return;
    }

    try {
      const createdFile = await this.plugin.app.vault.create(newFilePath, "");
      const targetLeaf = await this.plugin.openFileWithSettings(createdFile, { revealWhenNewTab: true });
      this.focusInlineTitleAtEnd(targetLeaf);
      new Notice(`已创建：${newFileBaseName}`);
    } catch (error) {
      console.error("Failed to create next chapter file:", error);
      new Notice("新建章节失败，请重试");
    }
  }

  private focusInlineTitleAtEnd(targetLeaf: WorkspaceLeaf | null): void {
    const tryFocus = () => {
      const view = targetLeaf?.view;
      const containerEl = (view as { containerEl?: HTMLElement } | null)?.containerEl;
      if (!containerEl) return false;

      const titleEl = containerEl.querySelector(".inline-title") as HTMLElement | null;
      if (!titleEl) return false;

      if (titleEl instanceof HTMLInputElement || titleEl instanceof HTMLTextAreaElement) {
        titleEl.focus();
        const end = titleEl.value.length;
        titleEl.setSelectionRange(end, end);
        return true;
      }

      if (titleEl.isContentEditable) {
        titleEl.focus();
        const selection = window.getSelection();
        if (!selection) return true;
        const range = document.createRange();
        range.selectNodeContents(titleEl);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      }

      return false;
    };

    if (tryFocus()) return;
    window.setTimeout(tryFocus, 30);
    window.setTimeout(tryFocus, 80);
  }

  private getDirectMarkdownSiblings(dirPath: string): TFile[] {
    return this.plugin.app.vault
      .getMarkdownFiles()
      .filter((file) => this.getParentDirPath(file.path) === dirPath);
  }

  private getParentDirPath(filePath: string): string {
    const separatorIndex = filePath.lastIndexOf("/");
    return separatorIndex === -1 ? "" : filePath.substring(0, separatorIndex);
  }

  private extractChapterNumber(fileBasename: string): number | null {
    const match = fileBasename.match(/^第(\d+)章(?:\s.*)?$/);
    if (!match?.[1]) return null;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
