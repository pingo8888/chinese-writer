// 解析单个md文件，返回md树
import { FileNode, H1Node, H2Node } from "./mdTree";

export function parseMdFile(text: string): { h1Nodes: H1Node[] } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  let inFrontmatter = false;
  let frontmatterDone = false;
  let inFenceCode = false;

  const h1Nodes: H1Node[] = [];
  let curH1: H1Node | null = null;
  let curH2: H2Node | null = null;

  const flushH2 = () => {
    if (curH1 && curH2) {
      curH2.content = curH2.content.replace(/\s+$/g, "");
      curH1.h2Nodes.push(curH2);
      // console.log("flushed h2: " + curH2.headerName + " to h1: " + curH1.headerName);
    }
    curH2 = null;
  }

  const flushH1 = () => {
    flushH2();
    if (curH1) {
      h1Nodes.push(curH1);
      // console.log("flushed h1: " + curH1.headerName);
      curH1 = null;
    }
  }

  for (const [i, line] of lines.entries()) {
    const lineTrim = line.trim();

    // --------------- frontmatter处理 ---------------
    if (!frontmatterDone) {
      // 只有第一行是"---"时，认为该文件有frontmatter
      if (i === 0 && lineTrim === "---") {
        inFrontmatter = true;
        continue;
      }
      if (inFrontmatter) {
        // 在frontmatter中，如果再次遇到"---"，认为frontmatter结束
        if (lineTrim === "---") {
          inFrontmatter = false;
          frontmatterDone = true;
        }
        continue;
      }
      // 即没有frontmatter，又不在frontmatter中，认为该文件没有frontmatter
      frontmatterDone = true;
    }

    // --------------- fence code部分处理 ---------------
    if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
      inFenceCode = !inFenceCode;
      if (curH2) curH2.content += (curH2.content ? "\n" : "") + line;
      continue;
    }

    if (inFenceCode) {
      if (curH2) curH2.content += (curH2.content ? "\n" : "") + line;
      continue;
    }

    // --------------- h1和h2标题部分处理 ---------------
    const h1Match = lineTrim.match(/^#\s+(.+?)\s*$/);
    const h2Match = lineTrim.match(/^##\s+(.+?)\s*$/);

    if (h1Match) {
      flushH1();
      if (h1Match[1] === undefined) continue;
      curH1 = { headerName: h1Match[1], h2Nodes: [] };
      // console.log("found new h1: " + curH1.headerName);
      continue;
    }
    if (h2Match) {
      // 丢弃孤立的h2
      if (!curH1) continue;

      flushH2();
      if (h2Match[1] === undefined) continue;
      curH2 = { headerName: h2Match[1], content: "" };
      // console.log("found new h2: " + curH2.headerName);
      continue;
    }

    // --------------- 普通文本部分处理 ---------------
    if (curH2) curH2.content += (curH2.content ? "\n" : "") + line;
  }
  flushH1();
  return { h1Nodes };
}