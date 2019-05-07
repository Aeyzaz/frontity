import { Component, createContext, createElement } from "react";
import { observe, unobserve, raw, isObservable } from ".";

export let isInsideFunctionComponent = false;
const COMPONENT = Symbol("owner component");

const context = createContext();

export const Provider = context.Provider;

function mapStateToStores(state) {
  // find store properties and map them to their none observable raw value
  // to do not trigger none static this.setState calls
  // from the static getDerivedStateFromProps lifecycle method
  const component = state[COMPONENT];
  return Object.keys(component)
    .map(key => component[key])
    .filter(isObservable)
    .map(raw);
}

export function connect(Comp) {
  const isStatelessComp = !(Comp.prototype && Comp.prototype.isReactComponent);

  const BaseComp = isStatelessComp ? Component : Comp;
  // a HOC which overwrites render, shouldComponentUpdate and componentWillUnmount
  // it decides when to run the new reactive methods and when to proxy to the original methods
  class ReactiveClassComp extends BaseComp {
    constructor(props, context) {
      super(props);

      this.store = context;

      this.state = this.state || {};
      this.state[COMPONENT] = this;

      // create a reactive render for the component
      this.render = observe(this.render, {
        scheduler: () => this.setState({}),
        lazy: true
      });
    }

    render() {
      return isStatelessComp
        ? Comp({ ...this.props, ...this.store }, this.context)
        : createElement(BaseComp, {
            ...this.props,
            ...this.store
          });
    }

    // react should trigger updates on prop changes, while Connect handles store changes
    shouldComponentUpdate(nextProps, nextState) {
      const { props, state } = this;

      // respect the case when the user defines a shouldComponentUpdate
      if (super.shouldComponentUpdate) {
        return super.shouldComponentUpdate(nextProps, nextState);
      }

      // return true if it is a reactive render or state changes
      if (state !== nextState) {
        return true;
      }

      // the component should update if any of its props shallowly changed value
      const keys = Object.keys(props);
      const nextKeys = Object.keys(nextProps);
      return (
        nextKeys.length !== keys.length ||
        nextKeys.some(key => props[key] !== nextProps[key])
      );
    }

    // add a custom deriveStoresFromProps lifecyle method
    static getDerivedStateFromProps(props, state) {
      if (super.deriveStoresFromProps) {
        // inject all local stores and let the user mutate them directly
        const stores = mapStateToStores(state);
        super.deriveStoresFromProps(props, ...stores);
      }
      // respect user defined getDerivedStateFromProps
      if (super.getDerivedStateFromProps) {
        return super.getDerivedStateFromProps(props, state);
      }
      return null;
    }

    componentWillUnmount() {
      // call user defined componentWillUnmount
      if (super.componentWillUnmount) {
        super.componentWillUnmount();
      }
      // clean up memory used by Easy State
      unobserve(this.render);
    }
  }

  ReactiveClassComp.contextType = context;

  ReactiveClassComp.displayName = Comp.displayName || Comp.name;
  // static props are inherited by class components,
  // but have to be copied for function components
  if (isStatelessComp) {
    for (let key of Object.keys(Comp)) {
      ReactiveClassComp[key] = Comp[key];
    }
  }

  return ReactiveClassComp;
}
