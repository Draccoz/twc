import { CustomElementOptions } from "twc/polymer";
import { Component, Method, MethodHook, Property, Style, Template } from "./builder";
import { getQuoteChar, Link, ParsedDecorator } from "./helpers";

/**
 * Additional meta data returned from a decorator (extra methods, properties and observers)
 */
export interface DecoratorExtras {
  methods?: Array<{[K in keyof Method]?: Method[K]}>;
  properties?: Array<{[K in keyof Property]?: Property[K]}>;
  observers?: Array<string>;
  hooks?: Map<string, MethodHook>;
}

/**
 * Manually register a property
 *
 * @this ParsedDecorator
 * @param property Property to decorate
 * @param config Property configuration object
 */
export function property(this: ParsedDecorator, property: Property, config: object): DecoratorExtras {
  return { properties: [ Object.assign(property, config) ] };
}

/**
 * Set `reflectToAttribute` of the component to true
 *
 * @this ParsedDecorator
 * @param property Property to decorate
 */
export function attr(this: ParsedDecorator, property: Property): void {
  property.reflectToAttribute = true;
}

/**
 * Set `computed` method for the property. If method name is provided, uses existing method. Otherwise, creates a new method and returns it.
 *
 * @this ParsedDecorator
 * @param property Property to decorate
 * @param ref Resolver as a method or a name of method from components prototype
 * @param args Array of arguments for resolver method
 *
 * @returns Object with added methods array
 */
export function compute(this: ParsedDecorator, property: Property, ref: string | Method, args: Array<string> = []): DecoratorExtras {
  if (args.length === 0 && typeof ref !== "string") {
    args = ref.argumentsNoType;
  }
  const quote = getQuoteChar(this.declaration);
  if (typeof ref === "string") {
    property.computed = `${quote}${ref}(${args.join(", ")})${quote}`;
    return { methods: [] };
  } else {
    property.computed = `${quote}${ref.name}(${args.join(", ")})${quote}`;
    return { methods: [ ref ] };
  }
}

/**
 * Set `notify` of the component to true
 *
 * @this ParsedDecorator
 * @param property Property to decorate
 */
export function notify(this: ParsedDecorator, property: Property): void {
  property.notify = true;
}

/**
 * Set `observer` of the property to provided method if there is only one dependency, otherwise add entry to observers.
 *
 * @this ParsedDecorator
 * @param method Method to trigger whenever any dependency changes
 * @param args List of dependencies
 *
 * @returns Patch for a property to update or observers to concat to all observers list
 */
export function observe(this: ParsedDecorator, method: Method, ...args: Array<string>): DecoratorExtras {
  if (args.length === 0) {
    args = method.argumentsNoType;
  }
  if (args.length === 1 && !args[ 0 ].includes(".")) {
    const quote = getQuoteChar(this.declaration);
    return { properties: [ { name: args[ 0 ], observer: `${quote}${method.name}${quote}` } ] };
  }
  return { observers: [ `${method.name}(${args.join(", ")})` ] };
}

/**
 * Add listeners to connectedCallback and remove them on disconnectedCallback (eventually remove them in first callback if `once` is set).
 *
 * @this ParsedDecorator
 * @param method Method to set as an event handler
 * @param eventName Event to bind add listener to
 * @param [once=false] Should listener be removed after first call?
 *
 * @returns Map with method names and hooks for them
 */
export function listen(this: ParsedDecorator, method: Method, eventName: string, once: boolean = false): DecoratorExtras {
  const gestureEvents = [ "down", "up", "track", "tap" ];
  const removeEvent = gestureEvents.includes(eventName) ?
    `Polymer.Gestures.removeListener(this, "${eventName}", this._${method.name}Bound);` :
    `this.removeEventListener("${eventName}", this._${method.name}Bound);`;
  const eventHandler = once ? `(...args) => { this.${method.name}(...args); ${removeEvent} }` : `this.${method.name}.bind(this)`;
  const addEvent = gestureEvents.includes(eventName) ?
    `Polymer.Gestures.addListener(this, "${eventName}", this._${method.name}Bound = ${eventHandler});` :
    `this.addEventListener("${eventName}", this._${method.name}Bound = ${eventHandler});`;
  return {
    hooks: once ? new Map([
      [ "connectedCallback", { place: "afterbegin" as any, statement: addEvent } ]
    ]) : new Map([
      [ "connectedCallback", { place: "afterbegin" as any, statement: addEvent } ],
      [ "disconnectedCallback", { place: "afterbegin" as any, statement: removeEvent } ]
    ])
  };
}

/**
 * Add styles to a component
 *
 * @this ParsedDecorator
 * @param component Component to add styles to
 * @param styles Array of styles to add to the component
 */
export function style(this: ParsedDecorator, component: Component, ...styles: Array<string>): void {
  component.styles = styles.map((css) => {
    if (css.endsWith(".css")) {
      return new Style(new Link(css, this.declaration));
    } else {
      return new Style(css, /^[\w\d]+(-[\w\d]+)+$/.test(css));
    }
  });
}

/**
 * Set template for the component
 *
 * @param component Component to add styles to
 * @param src Source of the template
 */
export function template(this: ParsedDecorator, component: Component, src: string): void {
  component.template = src.endsWith(".html") ? Template.fromLink(new Link(src, this.declaration)) : Template.fromString(src);
}

/**
 * Optional component config
 *
 * @param component Component to add styles to
 * @param config Config object
 */
export function CustomElement(this: ParsedDecorator, component: Component, config?: CustomElementOptions): void {
  if (!config) {
    return;
  }
  Object.assign(component.config, config);

  if (config.template) {
    template.call(this, component, config.template);
  }

  if (config.styles) {
    style.call(this, component, ...(Array.isArray(config.styles) ? config.styles : [ config.styles ]));
  }
}
