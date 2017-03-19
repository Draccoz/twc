import Polymer, { template, style, behavior, attr, notify, observe, computed } from "../../annotations/polymer";
import "imports/polymer.html";
import "imports/esp.html";

export namespace Polymer {
  export interface TheBehavior {
    created(): void;
  }
}

export interface ProfileChangeEvent extends CustomEvent {
  detail: {
    /** New profile. */
    newProfile: any;
  };
}
/** Fires whenever ** .. yo! */
export interface SomeEvent extends CustomEvent {
  detail: {
    deep: {
      property: boolean
    };
    /** New name */
    name: string;
  };
}

/**
 * A behavior
 */
const myBehavior = {
  test() {
    console.log("behavior test");
  }
};

export interface ElementName extends Polymer.TheBehavior {}

/**
 * A test class
 *
 * @demo test.html
 */
@template("template.element-name.html")
@style("h1 {color: red;}")
@style("style.css")
@style("shared-style")
@behavior(myBehavior)
export class ElementName extends Polymer.Element {
  /**
   * A greetings list
   */
  @attr greetings: Array<string>;
  readonly test: string = "tester";
  @notify profile: any;

  /**
   * Some static method
   */
  static staticTest(test: string, test2: {a: boolean, b: any}, test3?: number) {
    console.log("static");
  }

  /**
   * Observer method
   */
  @observe("profile.prop") observer(val: string) {
    console.log("val:", val);
  }

  @observe observerAuto(greetings: Array<string>) {
    console.log("greetings:", greetings);
  }

  @computed("test") computedProp(val: string) {
    console.log(val);
    return val + "!";
  }

  @computed computedPropAuto(test: string) {
    console.log("test:", test);
    return test + "!";
  }
}
