import { defined } from './util.js';
import { Outcome } from './types.js';
import { parseFen } from './fen.js';

export interface Game<T> {
  headers: Map<string, string>;
  comment?: string;
  moves: Node<T>;
}

export class Node<T> {
  children: ChildNode<T>[] = [];

  *mainline(): Iterable<T> {
    let node = this.children[0];
    while (node) {
      yield node.data;
      node = node.children[0];
    }
  }
}

export class ChildNode<T> extends Node<T> {
  constructor(public data: T) {
    super();
  }
}

export function transform<T, U, C extends { clone(): C }>(
  node: Node<T>,
  ctx: C,
  f: (ctx: C, data: T, i: number) => U | undefined
): Node<U> {
  const root = new Node<U>();
  const stack = [
    {
      before: node,
      after: root,
      ctx,
    },
  ];
  let frame;
  while ((frame = stack.pop())) {
    for (let i = 0; i < frame.before.children.length; i++) {
      const ctx = i < frame.before.children.length - 1 ? frame.ctx.clone() : frame.ctx;
      const childBefore = frame.before.children[i];
      const data = f(ctx, childBefore.data, i);
      if (defined(data)) {
        const childAfter = new ChildNode(data);
        frame.after.children.push(childAfter);
        stack.push({
          before: childBefore,
          after: childAfter,
          ctx,
        });
      }
    }
  }
  return root;
}

export interface PgnNodeData {
  san: string;
  startingComment?: string;
  comment?: string;
  nags?: number[];
}

export function makeOutcome(outcome: Outcome | undefined): string {
  if (!outcome) return '*';
  else if (outcome.winner === 'white') return '1-0';
  else if (outcome.winner === 'black') return '0-1';
  else return '1/2-1/2';
}

export function parseOutcome(s: string | undefined): Outcome | undefined {
  if (s === '1-0') return { winner: 'white' };
  else if (s === '0-1') return { winner: 'black' };
  else if (s === '1/2-1/2') return { winner: undefined };
  else return;
}

function escapeHeader(value: string): string {
  return value.replace('\\', '\\\\').replace('"', '\\"');
}

function safeComment(comment: string): string {
  return comment.replace('}', '');
}

interface AppendPgnFrame {
  state: 'pre' | 'sidelines' | 'end';
  ply: number;
  node: ChildNode<PgnNodeData>;
  sidelines: Iterator<ChildNode<PgnNodeData>>;
  startsVariation: boolean;
  inVariation: boolean;
}

export function makePgn(game: Game<PgnNodeData>): string {
  const builder = [],
    tokens = [];

  if (game.headers.size) {
    for (const [key, value] of game.headers.entries()) {
      builder.push('[', key, ' "', escapeHeader(value), '"]\n');
    }
    builder.push('\n');
  }

  if (game.comment) tokens.push('{', safeComment(game.comment), '}');

  const fen = game.headers.get('FEN');
  const initialPly = fen
    ? parseFen(fen).unwrap(
        setup => (setup.fullmoves - 1) * 2 + (setup.turn === 'white' ? 0 : 1),
        _ => 0
      )
    : 0;

  const stack: AppendPgnFrame[] = [];

  if (game.moves.children.length) {
    const variations = game.moves.children[Symbol.iterator]();
    stack.push({
      state: 'pre',
      ply: initialPly,
      node: variations.next().value,
      sidelines: variations,
      startsVariation: false,
      inVariation: false,
    });
  }

  let forceMoveNumber = true;
  while (stack.length) {
    const frame = stack[stack.length - 1];

    if (frame.inVariation) {
      tokens.push(')');
      frame.inVariation = false;
      forceMoveNumber = true;
    }

    if (frame.state == 'pre') {
      if (frame.node.data.startingComment) {
        tokens.push('{', safeComment(frame.node.data.startingComment), '}');
      }
      if (forceMoveNumber || frame.ply % 2 == 0) {
        tokens.push(Math.floor(frame.ply / 2) + 1 + (frame.ply % 2 == 0 ? '.' : '...'));
        forceMoveNumber = false;
      }
      tokens.push(frame.node.data.san);
      for (const nag of frame.node.data.nags || []) {
        tokens.push('$' + nag);
        forceMoveNumber = true;
      }
      if (frame.node.data.comment) {
        tokens.push('{', safeComment(frame.node.data.comment), '}');
        forceMoveNumber = true;
      }
      frame.state = 'sidelines';
    } else if (frame.state == 'sidelines') {
      const child = frame.sidelines.next();
      if (child.done) {
        if (frame.node.children.length) {
          const variations = frame.node.children[Symbol.iterator]();
          stack.push({
            state: 'pre',
            node: variations.next().value,
            sidelines: variations,
            inVariation: false,
            startsVariation: false,
            ply: frame.ply + 1,
          });
        }
        frame.state = 'end';
      } else {
        tokens.push('(');
        forceMoveNumber = true;
        stack.push({
          ply: frame.ply,
          startsVariation: true,
          node: child.value,
          sidelines: [][Symbol.iterator](),
          inVariation: false,
          state: 'pre',
        });
        frame.inVariation = true;
      }
    } else if (frame.state == 'end') {
      stack.pop();
    }
  }

  tokens.push(makeOutcome(parseOutcome(game.headers.get('Result'))));

  builder.push(tokens.join(' '));
  return builder.join('');
}

export function defaultHeaders(): Map<string, string> {
  return new Map([
    ['Event', '?'],
    ['Site', '?'],
    ['Date', '????.??.??'],
    ['Round', '?'],
    ['White', '?'],
    ['Black', '?'],
    ['Result', '*'],
  ]);
}