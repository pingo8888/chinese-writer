/**
 * 树节点类型
 */
export interface TreeNode {
  /** 节点唯一标识 */
  id: string;
  /** 显示文本 */
  text: string;
  /** 节点类型 */
  type: 'file' | 'h1' | 'h2';
  /** 子节点 */
  children: TreeNode[];
  /** 是否展开 */
  expanded: boolean;
  /** 原始内容（仅 h2 节点有内容） */
  content?: string[];
  /** 文件路径（仅 file 节点有） */
  filePath?: string;
}

/**
 * H1 标题信息
 */
export interface H1Info {
  /** H1 文本内容 */
  text: string;
  /** H1 在文件中的行号 */
  lineNumber: number;
  /** 该 H1 下的所有 H2 */
  h2List: H2Info[];
}

/**
 * H2 标题信息
 */
export interface H2Info {
  /** H2 文本内容 */
  text: string;
  /** H2 在文件中的行号 */
  lineNumber: number;
  /** H2 下的所有行内容 */
  content: string[];
}

/**
 * 文件解析结果
 */
export interface FileParseResult {
  /** 文件路径 */
  filePath: string;
  /** 文件名 */
  fileName: string;
  /** 该文件中的所有 H1 */
  h1List: H1Info[];
}

/**
 * 排序数据结构
 */
export interface OrderData {
  /** 文件排序：文件路径数组 */
  files: string[];
}
