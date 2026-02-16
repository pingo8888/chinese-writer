// 解析md文件夹，返回md树

import { App, TFile, TAbstractFile, TFolder } from "obsidian";
import { MdParseTree } from "./mdTree";
import { parseMdFile } from "./mdFileParser";

export async function parseFolderMdFiles(app: App, folderPath: string): Promise<MdParseTree> {

  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!folder || !(folder instanceof TFolder)) return [];

  const allMdFiles = app.vault.getMarkdownFiles();

  const mdFiles = allMdFiles.filter(file => file.path.startsWith(folderPath + "/"));

  const result: MdParseTree = [];
  for (const mdFile of mdFiles) {
    const content = await app.vault.read(mdFile);
    const mdParseTree = parseMdFile(content);

    result.push({
      fileName: mdFile.name,
      filePath: mdFile.path,
      h1Nodes: mdParseTree.h1Nodes,
    });
  }

  return result;

}