import { capitalize } from "lodash";

export function template({ propertiesMap, methodsMap, params }: AnnotationOptions) {
  return params.slice(1, params.length - 1);
}

export function attr(...args);
export function attr({ prop }: AnnotationOptions) {
  prop.reflectToAttribute = true;
}

export function notify(...args);
export function notify({ prop }: AnnotationOptions) {
  prop.notify = true;
}

export function observe(...args);
export function observe({ config, propertiesMap, observers, params }: AnnotationOptions) {
  let observedProps;

  if (params) {
    observedProps = params.replace(/["'`](.*)["'`]/, "$1").split(",");
  }
  else {
    observedProps = config.params.map(param => param.name);
  }

  if (observedProps.length === 1 && observedProps[ 0 ].includes(".") === false) {
    propertiesMap.get(observedProps[ 0 ]).observer = `"${config.name}"`;
  }
  else {
    observers.push(`"${config.name}(${observedProps.join(", ")})"`);
  }
}

export function computed(...args);
export function computed({ config, propertiesMap, method, params }: AnnotationOptions) {
  let observedProps;
  if (params) {
    observedProps = params.replace(/["'`](.*)["'`]/, "$1").split(",");
  }
  else {
    observedProps = config.params.map(param => param.name);
  }
  let name = config.name;
  method.name = `_compute${capitalize(name)}`;
  propertiesMap.set(name, { type: config.type, computed: `"${method.name}(${observedProps.join(", ")})"` });
}