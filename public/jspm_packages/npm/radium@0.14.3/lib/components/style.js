/* */ 
'use strict';
var camelCasePropsToDashCase = require('../camel-case-props-to-dash-case');
var createMarkupForStyles = require('../create-markup-for-styles');
var Prefixer = require('../prefixer');
var React = require('react');
var buildCssString = function buildCssString(selector, rules, prefix) {
  if (!selector || !rules) {
    return null;
  }
  var prefixedRules = prefix(rules, 'Style');
  var cssPrefixedRules = camelCasePropsToDashCase(prefixedRules);
  var serializedRules = createMarkupForStyles(cssPrefixedRules);
  return selector + '{' + serializedRules + '}';
};
var Style = React.createClass({
  displayName: 'Style',
  propTypes: {
    prefix: React.PropTypes.func.isRequired,
    rules: React.PropTypes.object,
    scopeSelector: React.PropTypes.string
  },
  getDefaultProps: function getDefaultProps() {
    return {
      prefix: Prefixer.getPrefixedStyle,
      scopeSelector: ''
    };
  },
  _buildStyles: function _buildStyles(styles) {
    var _this = this;
    return Object.keys(styles).reduce(function(accumulator, selector) {
      var rules = styles[selector];
      if (selector === 'mediaQueries') {
        accumulator += _this._buildMediaQueryString(rules);
      } else {
        var completeSelector = (_this.props.scopeSelector ? _this.props.scopeSelector + ' ' : '') + selector;
        accumulator += buildCssString(completeSelector, rules, _this.props.prefix) || '';
      }
      return accumulator;
    }, '');
  },
  _buildMediaQueryString: function _buildMediaQueryString(stylesByMediaQuery) {
    var _this2 = this;
    var contextMediaQueries = this._getContextMediaQueries();
    var mediaQueryString = '';
    Object.keys(stylesByMediaQuery).forEach(function(query) {
      var completeQuery = contextMediaQueries[query] ? contextMediaQueries[query] : query;
      mediaQueryString += '@media ' + completeQuery + '{' + _this2._buildStyles(stylesByMediaQuery[query]) + '}';
    });
    return mediaQueryString;
  },
  _getContextMediaQueries: function _getContextMediaQueries() {
    var contextMediaQueries = {};
    if (this.context && this.context.mediaQueries) {
      Object.keys(this.context.mediaQueries).forEach((function(query) {
        contextMediaQueries[query] = this.context.mediaQueries[query].media;
      }).bind(this));
    }
    return contextMediaQueries;
  },
  render: function render() {
    if (!this.props.rules) {
      return null;
    }
    var styles = this._buildStyles(this.props.rules);
    return React.createElement('style', {dangerouslySetInnerHTML: {__html: styles}});
  }
});
module.exports = Style;
