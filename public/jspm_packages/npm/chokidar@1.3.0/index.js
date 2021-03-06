/* */ 
(function(process) {
  'use strict';
  var EventEmitter = require('events').EventEmitter;
  var fs = require('fs');
  var sysPath = require('path');
  var asyncEach = require('async-each');
  var anymatch = require('anymatch');
  var globParent = require('glob-parent');
  var isGlob = require('is-glob');
  var isAbsolute = require('path-is-absolute');
  var NodeFsHandler = require('./lib/nodefs-handler');
  var FsEventsHandler = require('./lib/fsevents-handler');
  var arrify = function(value) {
    if (value == null)
      return [];
    return Array.isArray(value) ? value : [value];
  };
  var flatten = function(list, result) {
    if (result == null)
      result = [];
    list.forEach(function(item) {
      if (Array.isArray(item)) {
        flatten(item, result);
      } else {
        result.push(item);
      }
    });
    return result;
  };
  var isString = function(thing) {
    return typeof thing === 'string';
  };
  function FSWatcher(_opts) {
    var opts = {};
    if (_opts)
      for (var opt in _opts)
        opts[opt] = _opts[opt];
    this._watched = Object.create(null);
    this._closers = Object.create(null);
    this._ignoredPaths = Object.create(null);
    Object.defineProperty(this, '_globIgnored', {get: function() {
        return Object.keys(this._ignoredPaths);
      }});
    this.closed = false;
    this._throttled = Object.create(null);
    this._symlinkPaths = Object.create(null);
    function undef(key) {
      return opts[key] === undefined;
    }
    if (undef('persistent'))
      opts.persistent = true;
    if (undef('ignoreInitial'))
      opts.ignoreInitial = false;
    if (undef('ignorePermissionErrors'))
      opts.ignorePermissionErrors = false;
    if (undef('interval'))
      opts.interval = 100;
    if (undef('binaryInterval'))
      opts.binaryInterval = 300;
    this.enableBinaryInterval = opts.binaryInterval !== opts.interval;
    if (undef('useFsEvents'))
      opts.useFsEvents = !opts.usePolling;
    if (!FsEventsHandler.canUse())
      opts.useFsEvents = false;
    if (undef('usePolling') && !opts.useFsEvents) {
      opts.usePolling = process.platform === 'darwin';
    }
    if (undef('atomic'))
      opts.atomic = !opts.usePolling && !opts.useFsEvents;
    if (opts.atomic)
      this._pendingUnlinks = Object.create(null);
    if (undef('followSymlinks'))
      opts.followSymlinks = true;
    if (undef('awaitWriteFinish'))
      opts.awaitWriteFinish = false;
    if (opts.awaitWriteFinish === true)
      opts.awaitWriteFinish = {};
    var awf = opts.awaitWriteFinish;
    if (awf) {
      if (!awf.stabilityThreshold)
        awf.stabilityThreshold = 2000;
      if (!awf.pollInterval)
        awf.pollInterval = 100;
      this._pendingWrites = Object.create(null);
    }
    if (opts.ignored)
      opts.ignored = arrify(opts.ignored);
    this._isntIgnored = function(path, stat) {
      return !this._isIgnored(path, stat);
    }.bind(this);
    var readyCalls = 0;
    this._emitReady = function() {
      if (++readyCalls >= this._readyCount) {
        this._emitReady = Function.prototype;
        this._readyEmitted = true;
        process.nextTick(this.emit.bind(this, 'ready'));
      }
    }.bind(this);
    this.options = opts;
    Object.freeze(opts);
  }
  FSWatcher.prototype = Object.create(EventEmitter.prototype);
  FSWatcher.prototype._emit = function(event, path, val1, val2, val3) {
    if (this.options.cwd)
      path = sysPath.relative(this.options.cwd, path);
    var args = [event, path];
    if (val3 !== undefined)
      args.push(val1, val2, val3);
    else if (val2 !== undefined)
      args.push(val1, val2);
    else if (val1 !== undefined)
      args.push(val1);
    var awf = this.options.awaitWriteFinish;
    if (awf && this._pendingWrites[path])
      return this;
    if (this.options.atomic) {
      if (event === 'unlink') {
        this._pendingUnlinks[path] = args;
        setTimeout(function() {
          Object.keys(this._pendingUnlinks).forEach(function(path) {
            this.emit.apply(this, this._pendingUnlinks[path]);
            this.emit.apply(this, ['all'].concat(this._pendingUnlinks[path]));
            delete this._pendingUnlinks[path];
          }.bind(this));
        }.bind(this), 100);
        return this;
      } else if (event === 'add' && this._pendingUnlinks[path]) {
        event = args[0] = 'change';
        delete this._pendingUnlinks[path];
      }
    }
    if (event === 'change') {
      if (!this._throttle('change', path, 50))
        return this;
    }
    var emitEvent = function() {
      this.emit.apply(this, args);
      if (event !== 'error')
        this.emit.apply(this, ['all'].concat(args));
    }.bind(this);
    if (awf && event === 'add' && this._readyEmitted) {
      var awfEmit = function(err, stats) {
        if (err) {
          event = args[0] = 'error';
          args[1] = err;
          emitEvent();
        } else if (stats) {
          args.push(stats);
          emitEvent();
        }
      };
      this._awaitWriteFinish(path, awf.stabilityThreshold, awfEmit);
    } else if (this.options.alwaysStat && val1 === undefined && (event === 'add' || event === 'addDir' || event === 'change')) {
      fs.stat(path, function(error, stats) {
        if (error || !stats)
          return;
        args.push(stats);
        emitEvent();
      });
    } else {
      emitEvent();
    }
    return this;
  };
  FSWatcher.prototype._handleError = function(error) {
    var code = error && error.code;
    var ipe = this.options.ignorePermissionErrors;
    if (error && code !== 'ENOENT' && code !== 'ENOTDIR' && (!ipe || (code !== 'EPERM' && code !== 'EACCES')))
      this.emit('error', error);
    return error || this.closed;
  };
  FSWatcher.prototype._throttle = function(action, path, timeout) {
    if (!(action in this._throttled)) {
      this._throttled[action] = Object.create(null);
    }
    var throttled = this._throttled[action];
    if (path in throttled)
      return false;
    function clear() {
      delete throttled[path];
      clearTimeout(timeoutObject);
    }
    var timeoutObject = setTimeout(clear, timeout);
    throttled[path] = {
      timeoutObject: timeoutObject,
      clear: clear
    };
    return throttled[path];
  };
  FSWatcher.prototype._awaitWriteFinish = function(path, threshold, awfEmit) {
    var timeoutHandler;
    var fullPath = path;
    if (this.options.cwd && !isAbsolute(path)) {
      fullPath = sysPath.join(this.options.cwd, path);
    }
    var now = new Date();
    var awaitWriteFinish = (function(prevStat) {
      fs.stat(fullPath, function(err, curStat) {
        if (err) {
          if (err.code !== 'ENOENT')
            awfEmit(err);
          return;
        }
        var now = new Date();
        if (prevStat && curStat.size != prevStat.size) {
          this._pendingWrites[path].lastChange = now;
        }
        if (now - this._pendingWrites[path].lastChange >= threshold) {
          delete this._pendingWrites[path];
          awfEmit(null, curStat);
        } else {
          timeoutHandler = setTimeout(awaitWriteFinish.bind(this, curStat), this.options.awaitWriteFinish.pollInterval);
        }
      }.bind(this));
    }.bind(this));
    if (!(path in this._pendingWrites)) {
      this._pendingWrites[path] = {
        lastChange: now,
        cancelWait: function() {
          delete this._pendingWrites[path];
          clearTimeout(timeoutHandler);
        }.bind(this)
      };
      timeoutHandler = setTimeout(awaitWriteFinish.bind(this), this.options.awaitWriteFinish.pollInterval);
    }
  };
  var dotRe = /\..*\.(sw[px])$|\~$|\.subl.*\.tmp/;
  FSWatcher.prototype._isIgnored = function(path, stats) {
    if (this.options.atomic && dotRe.test(path))
      return true;
    if (!this._userIgnored) {
      var cwd = this.options.cwd;
      var ignored = this.options.ignored;
      if (cwd && ignored) {
        ignored = ignored.map(function(path) {
          if (typeof path !== 'string')
            return path;
          return isAbsolute(path) ? path : sysPath.join(cwd, path);
        });
      }
      var paths = arrify(ignored).filter(function(path) {
        return typeof path === 'string' && !isGlob(path);
      }).map(function(path) {
        return path + '/**/*';
      });
      this._userIgnored = anymatch(this._globIgnored.concat(ignored).concat(paths));
    }
    return this._userIgnored([path, stats]);
  };
  var replacerRe = /^\.[\/\\]/;
  FSWatcher.prototype._getWatchHelpers = function(path, depth) {
    path = path.replace(replacerRe, '');
    var watchPath = depth || !isGlob(path) ? path : globParent(path);
    var hasGlob = watchPath !== path;
    var globFilter = hasGlob ? anymatch(path) : false;
    var entryPath = function(entry) {
      return sysPath.join(watchPath, sysPath.relative(watchPath, entry.fullPath));
    };
    var filterPath = function(entry) {
      return (!hasGlob || globFilter(entryPath(entry))) && this._isntIgnored(entryPath(entry), entry.stat) && (this.options.ignorePermissionErrors || this._hasReadPermissions(entry.stat));
    }.bind(this);
    var getDirParts = function(path) {
      if (!hasGlob)
        return false;
      var parts = sysPath.relative(watchPath, path).split(/[\/\\]/);
      return parts;
    };
    var dirParts = getDirParts(path);
    if (dirParts && dirParts.length > 1)
      dirParts.pop();
    var unmatchedGlob;
    var filterDir = function(entry) {
      if (hasGlob) {
        var entryParts = getDirParts(entry.fullPath);
        var globstar = false;
        unmatchedGlob = !dirParts.every(function(part, i) {
          if (part === '**')
            globstar = true;
          return globstar || !entryParts[i] || anymatch(part, entryParts[i]);
        });
      }
      return !unmatchedGlob && this._isntIgnored(entryPath(entry), entry.stat);
    }.bind(this);
    var follow = this.options.followSymlinks;
    return {
      followSymlinks: follow,
      statMethod: follow ? 'stat' : 'lstat',
      path: path,
      watchPath: watchPath,
      entryPath: entryPath,
      hasGlob: hasGlob,
      globFilter: globFilter,
      filterPath: filterPath,
      filterDir: filterDir
    };
  };
  FSWatcher.prototype._getWatchedDir = function(directory) {
    var dir = sysPath.resolve(directory);
    var watcherRemove = this._remove.bind(this);
    if (!(dir in this._watched))
      this._watched[dir] = {
        _items: Object.create(null),
        add: function(item) {
          this._items[item] = true;
        },
        remove: function(item) {
          delete this._items[item];
          if (!this.children().length) {
            fs.readdir(dir, function(err) {
              if (err)
                watcherRemove(sysPath.dirname(dir), sysPath.basename(dir));
            });
          }
        },
        has: function(item) {
          return item in this._items;
        },
        children: function() {
          return Object.keys(this._items);
        }
      };
    return this._watched[dir];
  };
  FSWatcher.prototype._hasReadPermissions = function(stats) {
    return Boolean(4 & parseInt(((stats && stats.mode) & 0x1ff).toString(8)[0], 10));
  };
  FSWatcher.prototype._remove = function(directory, item) {
    var path = sysPath.join(directory, item);
    var fullPath = sysPath.resolve(path);
    var isDirectory = this._watched[path] || this._watched[fullPath];
    if (!this._throttle('remove', path, 100))
      return;
    var watchedDirs = Object.keys(this._watched);
    if (!isDirectory && !this.options.useFsEvents && watchedDirs.length === 1) {
      this.add(directory, item, true);
    }
    var nestedDirectoryChildren = this._getWatchedDir(path).children();
    nestedDirectoryChildren.forEach(function(nestedItem) {
      this._remove(path, nestedItem);
    }, this);
    var parent = this._getWatchedDir(directory);
    var wasTracked = parent.has(item);
    parent.remove(item);
    if (this.options.awaitWriteFinish && this._pendingWrites[path]) {
      this._pendingWrites[path].cancelWait();
      return;
    }
    delete this._watched[path];
    delete this._watched[fullPath];
    var eventName = isDirectory ? 'unlinkDir' : 'unlink';
    if (wasTracked && !this._isIgnored(path))
      this._emit(eventName, path);
    if (!this.options.useFsEvents) {
      this.unwatch(path);
    }
  };
  FSWatcher.prototype.add = function(paths, _origAdd, _internal) {
    var cwd = this.options.cwd;
    this.closed = false;
    paths = flatten(arrify(paths));
    if (!paths.every(isString)) {
      throw new TypeError('Non-string provided as watch path: ' + paths);
    }
    if (cwd)
      paths = paths.map(function(path) {
        if (isAbsolute(path)) {
          return path;
        } else if (path[0] === '!') {
          return '!' + sysPath.join(cwd, path.substring(1));
        } else {
          return sysPath.join(cwd, path);
        }
      });
    paths = paths.filter(function(path) {
      if (path[0] === '!')
        this._ignoredPaths[path.substring(1)] = true;
      else {
        delete this._ignoredPaths[path];
        delete this._ignoredPaths[path + '/**/*'];
        this._userIgnored = null;
        return true;
      }
    }, this);
    if (this.options.useFsEvents && FsEventsHandler.canUse()) {
      if (!this._readyCount)
        this._readyCount = paths.length;
      if (this.options.persistent)
        this._readyCount *= 2;
      paths.forEach(this._addToFsEvents, this);
    } else {
      if (!this._readyCount)
        this._readyCount = 0;
      this._readyCount += paths.length;
      asyncEach(paths, function(path, next) {
        this._addToNodeFs(path, !_internal, 0, 0, _origAdd, function(err, res) {
          if (res)
            this._emitReady();
          next(err, res);
        }.bind(this));
      }.bind(this), function(error, results) {
        results.forEach(function(item) {
          if (!item)
            return;
          this.add(sysPath.dirname(item), sysPath.basename(_origAdd || item));
        }, this);
      }.bind(this));
    }
    return this;
  };
  FSWatcher.prototype.unwatch = function(paths) {
    if (this.closed)
      return this;
    paths = flatten(arrify(paths));
    paths.forEach(function(path) {
      if (this._closers[path]) {
        this._closers[path]();
        delete this._closers[path];
        this._getWatchedDir(sysPath.dirname(path)).remove(sysPath.basename(path));
      } else {
        path = sysPath.resolve(path);
        this._ignoredPaths[path] = true;
        if (path in this._watched) {
          this._ignoredPaths[path + '/**/*'] = true;
        }
        this._userIgnored = null;
      }
    }, this);
    return this;
  };
  FSWatcher.prototype.close = function() {
    if (this.closed)
      return this;
    this.closed = true;
    Object.keys(this._closers).forEach(function(watchPath) {
      this._closers[watchPath]();
      delete this._closers[watchPath];
    }, this);
    this._watched = Object.create(null);
    this.removeAllListeners();
    return this;
  };
  function importHandler(handler) {
    Object.keys(handler.prototype).forEach(function(method) {
      FSWatcher.prototype[method] = handler.prototype[method];
    });
  }
  importHandler(NodeFsHandler);
  if (FsEventsHandler.canUse())
    importHandler(FsEventsHandler);
  exports.FSWatcher = FSWatcher;
  exports.watch = function(paths, options) {
    return new FSWatcher(options).add(paths);
  };
})(require('process'));
