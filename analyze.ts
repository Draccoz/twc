import { expect } from 'chai';
import { readFileSync } from 'fs';
import { ClassDeclaration, createSourceFile, ScriptTarget, SourceFile } from 'typescript';
import { Component, Import, RegisteredEvent } from './builder';
import { getFlatHeritage, inheritsFrom, isClassDeclaration, isImportDeclaration, isInterfaceDeclaration } from './helpers';

function parseStatements(source: SourceFile) {
  const statements = [];
  const variables = new Map<string, any>();

  source.statements.forEach((statement) => {
    if (isImportDeclaration(statement)) {
      const declaration = new Import(statement);
      declaration.imports.forEach((imp) => variables.set(imp.fullIdentifier, imp));
    } else if (isInterfaceDeclaration(statement)) {
      const name = statement.name.getText();
      if (variables.has(name) && variables.get(name) instanceof Component) {
        variables.get(name).behaviors.push(...getFlatHeritage(statement));
      } else if (inheritsFrom(statement, 'CustomEvent', 'Event')) {
        variables.set(name, new RegisteredEvent(statement));
      } else {
        variables.set(name, statement);
      }
    } else if (isClassDeclaration(statement) && inheritsFrom(statement as ClassDeclaration, 'Polymer.Element')) {
      const component = new Component(statement as ClassDeclaration);

      if (variables.has(component.name) && !(variables.get(component.name) instanceof Component)) {
        component.behaviors.push(...getFlatHeritage(variables.get(component.name)));
      }

      variables.set(component.name, component);
      statements.push(component);
      return;
    }
    statements.push(statement);
  });

  return { statements, variables };
}

describe('analyzer', () => {
  it('should analyze the source file and build the proper output', () => {
    const fileName = 'complex.ts';
    const content = readFileSync(fileName).toString();
    const source: SourceFile = createSourceFile(fileName, content, ScriptTarget.ES2015, true);

    const { statements, variables } = parseStatements(source);

    const components: Array<Component> = Array.from(variables.values()).filter((v) => v instanceof Component);
    const events: Array<RegisteredEvent> = Array.from(variables.values()).filter((v) => v instanceof RegisteredEvent);

    components.forEach((component) => component.events.push(...events));

    console.log({ statements, variables });

    expect(Array.from(statements)).to.have.lengthOf(1);
  });
});
