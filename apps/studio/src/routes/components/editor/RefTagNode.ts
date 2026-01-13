/**
 * RefTagNode - Custom Lexical node for reftag mentions
 * 
 * RefTags are inline text elements that create named input slots for prompt composition.
 * They appear as @name in the editor and are rendered as non-editable spans.
 */

import type {
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedTextNode,
  Spread,
} from 'lexical';
import { TextNode, $applyNodeReplacement } from 'lexical';

export type SerializedRefTagNode = Spread<
  {
    type: 'reftag';
    version: 1;
    refName: string;
  },
  SerializedTextNode
>;

export class RefTagNode extends TextNode {
  __refName: string;

  static getType(): string {
    return 'reftag';
  }

  static clone(node: RefTagNode): RefTagNode {
    return new RefTagNode(node.__refName, node.__text, node.__key);
  }

  constructor(refName: string, text?: string, key?: NodeKey) {
    super(text ?? `@${refName}`, key);
    this.__refName = refName;
  }

  static importJSON(serializedNode: SerializedRefTagNode): RefTagNode {
    const node = $createRefTagNode(serializedNode.refName);
    node.setTextContent(serializedNode.text);
    node.setFormat(serializedNode.format);
    node.setDetail(serializedNode.detail);
    node.setMode(serializedNode.mode);
    node.setStyle(serializedNode.style);
    return node;
  }

  exportJSON(): SerializedRefTagNode {
    return {
      ...super.exportJSON(),
      type: 'reftag',
      version: 1,
      refName: this.__refName,
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.className = 'reftag-node';
    dom.dataset.reftag = this.__refName;
    dom.spellcheck = false;
    return dom;
  }

  updateDOM(
    prevNode: this,
    dom: HTMLElement,
    config: EditorConfig
  ): boolean {
    const isUpdated = super.updateDOM(prevNode, dom, config);
    if (prevNode.__refName !== this.__refName) {
      dom.dataset.reftag = this.__refName;
    }
    return isUpdated;
  }

  getRefName(): string {
    return this.__refName;
  }

  /**
   * Cannot insert text before reftag
   */
  canInsertTextBefore(): boolean {
    return false;
  }

  /**
   * Cannot insert text after reftag
   */
  canInsertTextAfter(): boolean {
    return false;
  }

  /**
   * Mark as text entity (similar to mention/hashtag)
   * This ensures the node is treated as an atomic unit
   */
  isTextEntity(): true {
    return true;
  }
}

export function $createRefTagNode(refName: string): RefTagNode {
  const node = new RefTagNode(refName);
  // Make node non-editable
  node.setMode('token');
  return $applyNodeReplacement(node);
}

export function $isRefTagNode(
  node: LexicalNode | null | undefined
): node is RefTagNode {
  return node instanceof RefTagNode;
}
