import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import {
  BinaryExpression, BindingName, Block, BlockLike, CallExpression, ClassDeclaration, ClassElement, ClassExpression, createArrayLiteral,
  createBlock,
  createGetAccessor, createIdentifier, createLiteral, createMethod, createObjectLiteral, createParameter, createPrinter,
  createPropertyAssignment,
  createReturn, createToken, EmitHint, EqualsToken, Expression, ExpressionStatement, forEachChild, FunctionExpression,
  GetAccessorDeclaration, HeritageClause, Identifier, InterfaceDeclaration, isBinaryExpression, isDoStatement, isExpressionStatement,
  isForInStatement, isForOfStatement, isForStatement, isFunctionLike, isGetAccessorDeclaration, isIdentifier, isIfStatement,
  isPropertyDeclaration, isSetAccessorDeclaration, isSwitchStatement, isTryStatement, isWhileStatement, JSDoc, Modifier, NamedDeclaration,
  Node, ParameterDeclaration, PrefixUnaryExpression, PropertyAccessExpression, PropertyName, ReturnStatement, SourceFile, Statement,
  SyntaxKind, TypeParameterDeclaration
} from "typescript";
import { Constructor } from "../types";
import { ImportedNode, Method, Property } from "./builder";

type ClassOrInterface = ClassDeclaration | ClassExpression | InterfaceDeclaration;

interface AssignmentExpression<T = Expression> extends ExpressionStatement {
  expression: BinaryExpression & {
    operatorToken: EqualsToken;
    left: PropertyAccessExpression;
    right: T
  };
}

/**
 * List of types that do not change the overall type.
 */
export const transparentTypes = [
  SyntaxKind.AnyKeyword,
  SyntaxKind.VoidKeyword,
  SyntaxKind.NeverKeyword,
  SyntaxKind.NullKeyword,
  SyntaxKind.UndefinedKeyword
];

/**
 * Kinds to be treated as class methods.
 */
export const methodKinds = [ SyntaxKind.MethodDeclaration, SyntaxKind.Constructor ];

/**
 * Mixin adding jsDoc getter
 */
export const JSDocMixin = <TBase extends Constructor>(Base: TBase = class {
} as TBase) => class extends Base {
  public declaration: Node;

  /** JSDoc for the method */
  public get jsDoc(): string {
    const jsDoc = this.declaration && this.declaration[ "jsDoc" ] as Array<JSDoc>;
    return jsDoc ? `${jsDoc.map((doc) => doc.getText()).join("\n")}\n` : "";
  }

  /** JSDoc for the module in form of HTML comment */
  public get htmlDoc(): string {
    const jsDoc = this.declaration[ "jsDoc" ] as Array<JSDoc>;
    return jsDoc ? `\n<!--\n${
      jsDoc
        .map((doc) => doc
          .getText()
          .split("\n")
          .slice(1, -1)
          .map((line) => line.trim().slice(2))
          .join("\n")
        )
        .join("\n")
      }\n-->` : "";
  }
};

/**
 * Mixind adding decorators getter
 */
export const DecoratorsMixin = <TBase extends Constructor>(Base: TBase = class {
} as TBase) => class extends Base {
  public declaration: Node;

  public get decorators(): Array<ParsedDecorator> {
    return getDecorators(this.declaration as ClassElement | ClassDeclaration);
  }
};

/**
 * Mixin adding the functionality of updating identifiers of imported entities with a namespace.
 */
export const RefUpdaterMixin = <TBase extends Constructor>(Base: TBase = class {
} as TBase) => class extends Base {
  protected refs?: Map<string, ImportedNode>;
  protected skipSuper?: boolean;

  /**
   * Provide a references map to be updated in the declaration.
   *
   * @param variables Map of ImportedNode's
   * @param skipSuper Should a `super()` call be skipped (removed)?
   *
   * @returns Reference of the class instance (for convenience)
   */
  public provideRefs(variables: Map<string, ImportedNode>, skipSuper = false): this {
    this.refs = variables;
    this.skipSuper = skipSuper;
    return this;
  }

  /**
   * Get text from the statement, replacing refs when available
   *
   * @param statement Node from which to get text
   *
   * @returns Text representation of a statement
   */
  protected getText = (statement: Node): string => {
    if (this.refs) {
      return updateImportedRefs(statement, this.refs);
    } else {
      return statement.getText();
    }
  }
};

/**
 * Class holding a reference to a file. When converted to a string, the file is read and content is returned.
 */
export class Link {
  constructor(public uri: string, private source: Node) {
  }

  public toString() {
    return readFileSync(resolve(dirname(getRoot(this.source).fileName), this.uri)).toString();
  }
}

/**
 * A reference to an identifier. It will allow to get types from already visited entities.
 */
export class Ref {
  constructor(public ref: Identifier) {
  }

  public toString() {
    return this.ref.getText();
  }
}

/**
 * Class holding a node, which stringified can be wrapped with an anonymous function.
 */
export class InitializerWrapper extends RefUpdaterMixin() {
  constructor(private declaration: Node) {
    super();
  }

  public valueOf() {
    return new Function(`return ${this.getText(this.declaration)};`)();
  }

  public toString() {
    return new Function(`return ${this.getText(this.declaration)};`).toString().replace("anonymous", "");
  }
}

/**
 * Parsed decorator, extracting name and arguments list from a decorator declaration.
 */
export class ParsedDecorator extends RefUpdaterMixin() {
  /** Name of the decorator */
  public get name(): string {
    return hasArguments(this.declaration) ? this.declaration.expression.getText() : this.declaration.getText();
  }

  /** Arguments passed to the decorator */
  public get arguments() {
    if (!hasArguments(this.declaration)) {
      return void 0;
    }
    return this.declaration.arguments.map((arg) => {
      switch (arg.kind) {
        case SyntaxKind.ArrowFunction:
        case SyntaxKind.FunctionExpression:
          return new Method(arg as FunctionExpression, `_${this.variable.getText()}Computed`);
        case SyntaxKind.Identifier:
          return new Ref(arg as Identifier);
        default:
          const args = flattenChildren(arg)
            .filter(isIdentifier)
            .filter((node: Identifier & { parent: PropertyAccessExpression }) => node !== node.parent.name);
          return new Function(...args.map((node) => node.getText()), `return ${arg.getText()}`)(...args);
      }
    });
  }

  constructor(public readonly declaration: Identifier | CallExpression, private readonly variable: Identifier) {
    super();
  }

  public valueOf(): { name: string, arguments: Array<any> } {
    return { name: this.name, arguments: this.arguments };
  }
}

/**
 * Get list of decorators with their arguments (if decorator is a call expression), as an array of ParsedDecorator's.
 *
 * @param declaration Class Element or Class Declaration to get decorators from
 *
 * @returns List of parsed decorators
 */
export const getDecorators = (declaration: ClassElement | ClassDeclaration): Array<ParsedDecorator> => {
  if (!declaration.decorators) {
    return [];
  }
  return declaration.decorators
    .map(({ expression }) => new ParsedDecorator(expression as any, declaration.name as Identifier));
};

/**
 * Get list of all return statements for the block (including inner blocks, but not functions)
 *
 * @param block Block to get returns from
 *
 * @returns List of return type nodes
 */
export const getReturnStatements = (block: BlockLike | Statement | BlockLike): Array<ReturnStatement> => {
  if (!block) {
    return [];
  }
  if (isIfStatement(block)) {
    return [
      ...getReturnStatements(block.thenStatement),
      ...getReturnStatements(block.elseStatement)
    ];
  }
  return ((block as BlockLike).statements || [ block ] as Array<Statement>)
    .map((node) => {
      if (isIfStatement(node)) {
        return [
          ...getReturnStatements(node.thenStatement),
          ...getReturnStatements(node.elseStatement)
        ];
      } else if (isTryStatement(node)) {
        return [
          ...getReturnStatements(node.tryBlock),
          ...getReturnStatements(node.catchClause.block),
          ...getReturnStatements(node.finallyBlock)
        ];
      } else if (
        isForStatement(node)
        || isDoStatement(node)
        || isWhileStatement(node)
        || isForInStatement(node)
        || isForOfStatement(node)
      ) {
        return getReturnStatements(node.statement);
      } else if (isSwitchStatement(node)) {
        return node.caseBlock.clauses
          .map(getReturnStatements)
          .reduce((all, curr) => [ ...all, ...curr ], []);
      }
      return [ node ];
    })
    .reduce((all, curr) => [ ...all, ...curr ], [])
    .filter((statement) => statement.kind === SyntaxKind.ReturnStatement) as Array<ReturnStatement>;
};

/**
 * Flatten mixin calls chain to an array of used mixins.
 *
 * @param expression Class extends expression
 * @param refs Map of imported references
 *
 * @returns Array of used mixin names
 */
export const flatExtends = (expression: Node, refs?: Map<string, ImportedNode>): Array<string> => {
  const getText = (expr: Node) => {
    return refs ? updateImportedRefs(expr, refs) : expr.getText();
  };

  if (hasArguments(expression)) {
    const deepList = [ getText(expression.expression), ...expression.arguments.map((arg) => flatExtends(arg)) ];
    return deepList.reduce((p: Array<string>, c) => p.concat(c), []) as any;
  } else {
    return [ getText(expression) ];
  }
};

/**
 * Flatten mixin calls from Class Element or Class Declaration.
 *
 * @param declaration Class Element or Class Declaration to get decorators from
 * @param refs Map of imported references
 *
 * @returns Array of used mixin names
 */
export const getFlatHeritage = (declaration: ClassOrInterface, refs?: Map<string, ImportedNode>): Array<string> => {
  if (!declaration.heritageClauses) {
    return [];
  }

  return declaration
    .heritageClauses
    .filter(isExtendsDeclaration)
    .map(toProperty("types"))
    .reduce(flattenArray, [])
    .map(toProperty("expression"))
    .map((node) => flatExtends(node, refs))
    .reduce(flattenArray, []);
};

/**
 * Checks whether class or interface inherits from a class or mixin (at least one of provided names).
 *
 * @param declaration Declaration to run the check on
 * @param names List of names to check
 *
 * @returns Whether class or interface inherits from provided class/mixin name
 */
export const inheritsFrom = (declaration: ClassOrInterface, ...names: Array<string>): boolean => {
  if (!declaration.heritageClauses) {
    return false;
  }

  const types = getFlatHeritage(declaration);

  return names.some((name) => types.includes(name));
};

/**
 * Checks whether class member has a provided modifier.
 *
 * @param declaration Class element (property or method) to run check on
 * @param mod Modifier to check
 *
 * @returns Whether class member has a provided modifier
 */
export const hasModifier = (declaration: ClassElement, mod: SyntaxKind): boolean => {
  return declaration.modifiers ? declaration.modifiers.some(({ kind }) => kind === mod) : false;
};

/**
 * Checks whether class or class member has a provided decorator (by name).
 *
 * @param declaration Class or class element to run check on
 * @param decoratorName Name of the decorator to check
 *
 * @returns Whether class or class member has a provided decorator
 */
export const hasDecorator = (declaration: ClassElement | ClassDeclaration, decoratorName: string): boolean => {
  if (!declaration.decorators) {
    return false;
  }
  return declaration.decorators.some(({ expression }) => {
    return (hasExpression(expression) ? expression.expression : expression).getText() === decoratorName;
  });
};

/**
 * Checks if at least one of the filters pass
 *
 * @param filters List of filters
 *
 * @returns A filter method (to pass to the array filter)
 */
export const isOneOf = (...filters) => (item: any): boolean => filters.some((filter) => filter(item));

/**
 * Checks if all of the filters pass
 *
 * @param filters List of filters
 *
 * @returns A filter method (to pass to the array filter)
 */
export const isAllOf = (...filters) => (item: any): boolean => filters.every((filter) => filter(item));

/**
 * Check if node is of a given kind
 */
export const isOfKind = <T extends Node>(kind) => (st: T): st is T => st.kind === kind;

/**
 * Checks if expression is a BinaryExpression.
 *
 * @param expr Node to check
 *
 * @returns Whether node is a BinaryExpression
 */
export const hasOperatorToken = (expr: Node): expr is BinaryExpression => "operatorToken" in expr;

/**
 * Checks if expression is an ExpressionStatement.
 *
 * @param expr Node to check
 *
 * @returns Whether node is an ExpressionStatement
 */
export const hasExpression = (expr: Node): expr is ExpressionStatement => "expression" in expr;

/**
 * Checks if expression is a PrefixUnaryExpression.
 *
 * @param expr Node to check
 *
 * @returns Whether node is a PrefixUnaryExpression
 */
export const hasOperator = (expr: Node): expr is PrefixUnaryExpression => "operator" in expr;

/**
 * Checks if expression is a CallExpression.
 *
 * @param expr Node to check
 *
 * @returns Whether node is a CallExpression
 */
export const hasArguments = (expr: Node): expr is CallExpression => "arguments" in expr;

/**
 * Checks if expression is an Identifier.
 *
 * @param expr Node to check
 *
 * @returns Whether node is an Identifier
 */
export const hasOriginalKeywordKind = (expr: Node): expr is Identifier => "originalKeywordKind" in expr;

/**
 * Checks if heritage clause is an ExtendsDeclaration.
 *
 * @param heritage HeritageClause to check
 *
 * @returns Whether clause is an ExtendsDeclaration
 */
export const isExtendsDeclaration = (heritage: HeritageClause): boolean => heritage.token === SyntaxKind.ExtendsKeyword;

export const isStatement = (node: any): node is Statement => "pos" in node;

/**
 * Checks if expression is an assignment expression
 */
export const isAssignmentExpression = <T = Expression>(expr: Node): expr is AssignmentExpression<T> => isExpressionStatement(expr)
  && isBinaryExpression(expr.expression)
  && expr.expression.operatorToken.kind === SyntaxKind.EqualsToken;

/**
 * Checks if ClassElement is private.
 *
 * @param el ClassElement to check
 *
 * @returns Whether element is private
 */
export const isPrivate = (el: ClassElement): boolean => hasModifier(el, SyntaxKind.PrivateKeyword);

/**
 * Checks if ClassElement is public.
 *
 * @param el ClassElement to check
 *
 * @returns Whether element is public
 */
export const isPublic = (el: ClassElement): boolean => hasModifier(el, SyntaxKind.PublicKeyword);

/**
 * Checks if ClassElement is static.
 *
 * @param el ClassElement to check
 *
 * @returns Whether element is static
 */
export const isStatic = (el: ClassElement): boolean => hasModifier(el, SyntaxKind.StaticKeyword);

/**
 * Checks if node is of transparent type.
 *
 * @param el Node to check
 *
 * @returns Whether node is of transparent type
 */
export const isTransparent = (el: Node): boolean => transparentTypes.includes(el.kind);

/**
 * Checks if ClassElement is not private.
 *
 * @param el ClassElement to check
 *
 * @returns Whether element is not private
 */
export const notPrivate = (el: ClassElement): boolean => !isPrivate(el);

/**
 * Checks if ClassElement is not public.
 *
 * @param el ClassElement to check
 *
 * @returns Whether element is not public
 */
export const notPublic = (el: ClassElement): boolean => !isPublic(el);

/**
 * Checks if ClassElement is not static.
 *
 * @param el ClassElement to check
 *
 * @returns Whether element is not static
 */
export const notStatic = (el: ClassElement): boolean => !isStatic(el);

/**
 * Checks if node is not of a transparent type.
 *
 * @param el Node to check
 *
 * @returns Whether node is not of a transparent type
 */
export const notTransparent = (el: Node): boolean => !transparentTypes.includes(el.kind);

/**
 * Checks if ClassElement is not a property.
 *
 * @param el ClassElement to check
 *
 * @returns Whether element is not a property
 */
export const notPropertyDeclaration = (el: ClassElement): boolean => !isPropertyDeclaration(el);

/**
 * Checks if ClassElement is not a method.
 *
 * @param el ClassElement to check
 *
 * @returns Whether element is not a method
 */
export const notFunctionLike = (el: ClassElement): boolean => !isFunctionLike(el);

/**
 * Checks if ClassElement is not a getter.
 *
 * @param el ClassElement to check
 *
 * @returns Whether element is not a getter
 */
export const notGetAccessorDeclaration = (el: ClassElement): boolean => !isGetAccessorDeclaration(el);

/**
 * Checks if ClassElement is not a setter.
 *
 * @param el ClassElement to check
 *
 * @returns Whether element is not a setter
 */
export const notSetAccessorDeclaration = (el: ClassElement): boolean => !isSetAccessorDeclaration(el);

/**
 * Calls toString on passed object.
 *
 * @example
 * arr.map(toString)
 *
 * @param object Object to convert to string
 *
 * @returns String representation of an object
 */
export const toString = (object: any): string => object.toString();

/**
 * Calls getText on passed node.
 *
 * @example
 * arr.map(getText)
 *
 * @param node Node to get text from
 *
 * @returns Text of a node
 */
export const getText = (node: Node): string => node.getText();

/**
 * Flattens an array.
 *
 * @example
 * arr.reduce(flattenArray, [])
 *
 * @param arr Array of previous items
 * @param item Current item
 *
 * @returns Concatenated array and item
 */
export const flattenArray = (arr: Array<any>, item: any): Array<any> => arr.concat(item);

/**
 * Maps item to a given property.
 *
 * @example
 * arr.map(toProperty('firstName'))
 *
 * @param key Key to extract
 *
 * @returns {Function} A function to map an item
 */
export const toProperty = (key: string): (obj: any) => any => (obj: { [key: string]: any }) => obj[ key ];

/**
 * Strip quotes from beginning and the end of a provided string.
 * *Function does NOT trim whitespace*
 *
 * @param str String to strip quotes from
 * @param [char] Quote character to strip
 *
 * @returns String without leading and trailing quotes
 */
export const stripQuotes = (str: string, char?: "`" | "\"" | "'"): string => {
  if (str[ 0 ] === str[ str.length - 1 ] && (char && str[ 0 ] === char || [ "`", "\"", "'" ].includes(str[ 0 ]))) {
    return str.slice(1, -1);
  }
  return str;
};

/**
 * Flatten all children within a node.
 *
 * @param node Node to fetch children from
 *
 * @returns Array of nodes
 */
export const flattenChildren = (node: Node): Array<Node> => {
  const list = [ node ];
  forEachChild(node, (deep) => {
    list.push(...flattenChildren(deep));
  });
  return list;
};

/**
 * Find first occurrence of node with given kind.
 *
 * @param node Node to traverse
 * @param kind Kind to search for
 *
 * @returns Found node or null
 */
export const findNodeOfKind = (node: Node, kind: SyntaxKind): Node | null => {
  let result: Node = null;
  if (node.kind === kind) {
    result = node;
  }
  forEachChild(node, (deep) => {
    if (result) {
      return;
    }
    result = findNodeOfKind(deep, kind) || result;
  });
  return result;
};

/**
 * Get first quote character and return it.
 *
 * @param declaration Node from which root to search for a quote char
 *
 * @returns A quote character
 */
export const getQuoteChar = (declaration: Node): string => findNodeOfKind(getRoot(declaration), SyntaxKind.StringLiteral).getText()[ 0 ];

/**
 * Get root of the AST tree.
 *
 * @param node Node to start searching from
 *
 * @returns A root source file
 */
export const getRoot = (node: Node): SourceFile => {
  let root = node;
  while (node.parent) {
    root = node = node.parent;
  }
  return root as SourceFile;
};

/**
 * Update references to imported nodes in a given source.
 *
 * @param src Source to update references in
 * @param vars Map of ImportedNode's to update source with
 *
 * @returns Text of source node with updated refs
 */
export const updateImportedRefs = (src: Node, vars: Map<string, ImportedNode>): string => {
  const printer = createPrinter({ removeComments: false }, {
    substituteNode(hint: EmitHint, node: Identifier & { parent: NamedDeclaration }) {
      if (node.constructor.name !== "IdentifierObject" || !node.parent || node.parent.name === node || !vars.has(node.getText())) {
        return node;
      }
      return createIdentifier(vars.get(node.getText()).fullIdentifier);
    }
  });
  return printer.printNode(EmitHint.Unspecified, src, getRoot(src));
};

/**
 * Convert a system path to web URL
 *
 * @param path Path to convert
 *
 * @returns URL
 */
export const pathToURL = (path: string): string => path.replace(/\\/g, "/");

export function createSimpleMethod(name: string | PropertyName,
                                   statements: Array<Statement> | Block,
                                   parameters: Array<ParameterDeclaration> = [],
                                   modifiers: Array<Modifier> = [],
                                   typeParameters: Array<TypeParameterDeclaration> = []) {
  return createMethod(
    [],
    modifiers,
    void 0,
    name,
    void 0,
    typeParameters,
    parameters,
    void 0,
    Array.isArray(statements) ? createBlock(statements, true) : statements
  );
}

export function createSimpleParameter(name: string | BindingName, initializer?: Expression, optional = false) {
  return createParameter([], [], void 0, name, optional ? createToken(SyntaxKind.QuestionToken) : void 0, void 0, initializer);
}

export const buildExpression = (expr) => {
  if (Array.isArray(expr)) {
    return createArrayLiteral(expr.map((e) => buildExpression(e)), true);
  } else if (typeof expr !== "object") {
    return createLiteral(expr);
  } else if (expr && expr.constructor.name === "IdentifierObject") {
    return expr;
  } else {
    return buildObject(expr);
  }
};

export const buildObject = (props) => {
  if (Array.isArray(props)) {
    return buildExpression(props);
  }
  return createObjectLiteral(Object
    .keys(props)
    .map((key) => [ key, props[ key ] ])
    .map(([ key, value ]) => createPropertyAssignment(key, buildExpression(value))), true);
};

export const buildProperties = (props: Array<Property>): GetAccessorDeclaration => {
  return createGetAccessor([], [ createToken(SyntaxKind.StaticKeyword) ], "properties", [], void 0, createBlock([
    createReturn(
      buildObject(props.reduce((config, { name, type, value, computed, notify, observer, readOnly, reflectToAttribute }) => {
        const prop = { type } as Property;
        if (value !== undefined) {
          prop.value = value;
        }
        if (computed) {
          prop.computed = computed;
        }
        if (notify) {
          prop.notify = true;
        }
        if (observer) {
          prop.observer = observer;
        }
        if (readOnly) {
          prop.readOnly = true;
        }
        if (reflectToAttribute) {
          prop.reflectToAttribute = true;
        }
        if (Object.keys(prop).length === 1) {
          config[ name ] = type;
        } else {
          config[ name ] = prop;
        }
        return config;
      }, {}))
    )
  ], true));
};

export const buildObservers = (methods: Array<{ name: Node, args: Array<Node>, isComplex: boolean }>): GetAccessorDeclaration => {
  return createGetAccessor([], [ createToken(SyntaxKind.StaticKeyword) ], "observers", [], void 0, createBlock([
    createReturn(
      buildObject(
        methods
          .filter(({ isComplex }) => isComplex)
          .map(({ name, args }) => `${name.getText()}(${args.map((arg: Identifier) => arg.text).join(", ")})`)
      )
    )
  ], true));
};
