export type MdParseTree = FileNode[]

export interface FileNode {
  fileName: string;
  filePath: string;
  h1Nodes: H1Node[];
}

export interface H1Node {
  headerName: string;
  h2Nodes: H2Node[];
}

export interface H2Node {
  headerName: string;
  content: string;
}