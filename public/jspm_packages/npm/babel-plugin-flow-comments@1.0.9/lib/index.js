/* */ 
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

exports["default"] = function (_ref) {
  var Plugin = _ref.Plugin;
  var t = _ref.types;

  function wrapInFlowComment(context, parent) {
    context.addComment("trailing", generateComment(context, parent));
    context.replaceWith(t.noop());
  }

  function generateComment(context, parent) {
    var comment = context.getSource().replace(/\*-\//g, "*-ESCAPED/").replace(/\*\//g, "*-/");
    if (parent && parent.optional) comment = "?" + comment;
    if (comment[0] !== ":") comment = ":: " + comment;
    return comment;
  }

  return new Plugin("flow-comments", {
    visitor: {
      TypeCastExpression: function TypeCastExpression(node) {
        this.get("expression").addComment("trailing", generateComment(this.get("typeAnnotation")));
        this.replaceWith(t.parenthesizedExpression(node.expression));
      },

      // support function a(b?) {}
      Identifier: function Identifier(node, parent, scope, file) {
        if (!node.optional || node.typeAnnotation) {
          return;
        }
        this.addComment("trailing", ":: ?");
      },

      // strip optional property from function params - facebook/fbjs#17
      Function: {
        exit: function exit(node) {
          for (var i = 0; i < node.params.length; i++) {
            var param = node.params[i];
            param.optional = false;
          }
        }
      },

      // support `export type a = {}` - #8 Error: You passed path.replaceWith() a falsy node
      "ExportNamedDeclaration|Flow": function ExportNamedDeclarationFlow(node, parent, scope, file) {
        if (t.isExportNamedDeclaration(node) && !t.isFlow(node.declaration)) {
          return;
        }
        wrapInFlowComment(this, parent);
      },

      // support `import type A` and `import typeof A` #10
      ImportDeclaration: function ImportDeclaration(node, parent, scope, file) {
        if (t.isImportDeclaration(node) && node.importKind !== "type" && node.importKind !== "typeof") {
          return;
        }
        wrapInFlowComment(this, parent);
      }
    }
  });
};

module.exports = exports["default"];