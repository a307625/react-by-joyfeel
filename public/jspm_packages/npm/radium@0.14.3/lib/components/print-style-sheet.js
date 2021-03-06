/* */ 
'use strict';
var React = require('react');
var Style = require('./style');
var printStyles = require('../print-styles');
var PrintStyle = React.createClass({
  displayName: 'PrintStyle',
  getInitialState: function getInitialState() {
    return this._getStylesState();
  },
  componentDidMount: function componentDidMount() {
    this.subscription = printStyles.subscribe(this._onChange);
  },
  componentWillUnmount: function componentWillUnmount() {
    this.subscription.remove();
  },
  _onChange: function _onChange() {
    this.setState(this._getStylesState());
  },
  _getStylesState: function _getStylesState() {
    return {styles: printStyles.getPrintStyles()};
  },
  render: function render() {
    return React.createElement(Style, {rules: {mediaQueries: {print: this.state.styles}}});
  }
});
module.exports = PrintStyle;
