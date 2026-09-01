var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined")
    return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// node:url
var exports_url = {};
__export(exports_url, {
  resolveObject: () => urlResolveObject,
  resolve: () => urlResolve,
  parse: () => urlParse,
  format: () => urlFormat,
  default: () => url_default,
  Url: () => Url,
  URLSearchParams: () => URLSearchParams,
  URL: () => URL2
});
function util_isString(arg) {
  return typeof arg === "string";
}
function util_isObject(arg) {
  return typeof arg === "object" && arg !== null;
}
function util_isNull(arg) {
  return arg === null;
}
function util_isNullOrUndefined(arg) {
  return arg == null;
}
function Url() {
  this.protocol = null, this.slashes = null, this.auth = null, this.host = null, this.port = null, this.hostname = null, this.hash = null, this.search = null, this.query = null, this.pathname = null, this.path = null, this.href = null;
}
function urlParse(url, parseQueryString, slashesDenoteHost) {
  if (url && util_isObject(url) && url instanceof Url)
    return url;
  var u = new Url;
  return u.parse(url, parseQueryString, slashesDenoteHost), u;
}
function urlFormat(obj) {
  if (util_isString(obj))
    obj = urlParse(obj);
  if (!(obj instanceof Url))
    return Url.prototype.format.call(obj);
  return obj.format();
}
function urlResolve(source, relative) {
  return urlParse(source, false, true).resolve(relative);
}
function urlResolveObject(source, relative) {
  if (!source)
    return relative;
  return urlParse(source, false, true).resolveObject(relative);
}
var URL2, URLSearchParams, protocolPattern, portPattern, simplePathPattern, delims, unwise, autoEscape, nonHostChars, hostEndingChars, hostnameMaxLen = 255, hostnamePartPattern, hostnamePartStart, unsafeProtocol, hostlessProtocol, slashedProtocol, querystring, url_default;
var init_url = __esm(() => {
  ({ URL: URL2, URLSearchParams } = globalThis);
  protocolPattern = /^([a-z0-9.+-]+:)/i;
  portPattern = /:[0-9]*$/;
  simplePathPattern = /^(\/\/?(?!\/)[^\?\s]*)(\?[^\s]*)?$/;
  delims = ["<", ">", '"', "`", " ", "\r", `
`, "\t"];
  unwise = ["{", "}", "|", "\\", "^", "`"].concat(delims);
  autoEscape = ["'"].concat(unwise);
  nonHostChars = ["%", "/", "?", ";", "#"].concat(autoEscape);
  hostEndingChars = ["/", "?", "#"];
  hostnamePartPattern = /^[+a-z0-9A-Z_-]{0,63}$/;
  hostnamePartStart = /^([+a-z0-9A-Z_-]{0,63})(.*)$/;
  unsafeProtocol = { javascript: true, "javascript:": true };
  hostlessProtocol = { javascript: true, "javascript:": true };
  slashedProtocol = { http: true, https: true, ftp: true, gopher: true, file: true, "http:": true, "https:": true, "ftp:": true, "gopher:": true, "file:": true };
  querystring = { parse(str) {
    var decode = decodeURIComponent;
    return (str + "").replace(/\+/g, " ").split("&").filter(Boolean).reduce(function(obj, item, index) {
      var ref = item.split("="), key = decode(ref[0] || ""), val = decode(ref[1] || ""), prev = obj[key];
      return obj[key] = prev === undefined ? val : [].concat(prev, val), obj;
    }, {});
  }, stringify(obj) {
    var encode = encodeURIComponent;
    return Object.keys(obj || {}).reduce(function(arr, key) {
      return [].concat(obj[key]).forEach(function(v) {
        arr.push(encode(key) + "=" + encode(v));
      }), arr;
    }, []).join("&").replace(/\s/g, "+");
  } };
  Url.prototype.parse = function(url, parseQueryString, slashesDenoteHost) {
    if (!util_isString(url))
      throw TypeError("Parameter 'url' must be a string, not " + typeof url);
    var queryIndex = url.indexOf("?"), splitter = queryIndex !== -1 && queryIndex < url.indexOf("#") ? "?" : "#", uSplit = url.split(splitter), slashRegex = /\\/g;
    uSplit[0] = uSplit[0].replace(slashRegex, "/"), url = uSplit.join(splitter);
    var rest = url;
    if (rest = rest.trim(), !slashesDenoteHost && url.split("#").length === 1) {
      var simplePath = simplePathPattern.exec(rest);
      if (simplePath) {
        if (this.path = rest, this.href = rest, this.pathname = simplePath[1], simplePath[2])
          if (this.search = simplePath[2], parseQueryString)
            this.query = querystring.parse(this.search.substr(1));
          else
            this.query = this.search.substr(1);
        else if (parseQueryString)
          this.search = "", this.query = {};
        return this;
      }
    }
    var proto = protocolPattern.exec(rest);
    if (proto) {
      proto = proto[0];
      var lowerProto = proto.toLowerCase();
      this.protocol = lowerProto, rest = rest.substr(proto.length);
    }
    if (slashesDenoteHost || proto || rest.match(/^\/\/[^@\/]+@[^@\/]+/)) {
      var slashes = rest.substr(0, 2) === "//";
      if (slashes && !(proto && hostlessProtocol[proto]))
        rest = rest.substr(2), this.slashes = true;
    }
    if (!hostlessProtocol[proto] && (slashes || proto && !slashedProtocol[proto])) {
      var hostEnd = -1;
      for (var i = 0;i < hostEndingChars.length; i++) {
        var hec = rest.indexOf(hostEndingChars[i]);
        if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
          hostEnd = hec;
      }
      var auth, atSign;
      if (hostEnd === -1)
        atSign = rest.lastIndexOf("@");
      else
        atSign = rest.lastIndexOf("@", hostEnd);
      if (atSign !== -1)
        auth = rest.slice(0, atSign), rest = rest.slice(atSign + 1), this.auth = decodeURIComponent(auth);
      hostEnd = -1;
      for (var i = 0;i < nonHostChars.length; i++) {
        var hec = rest.indexOf(nonHostChars[i]);
        if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
          hostEnd = hec;
      }
      if (hostEnd === -1)
        hostEnd = rest.length;
      this.host = rest.slice(0, hostEnd), rest = rest.slice(hostEnd), this.parseHost(), this.hostname = this.hostname || "";
      var ipv6Hostname = this.hostname[0] === "[" && this.hostname[this.hostname.length - 1] === "]";
      if (!ipv6Hostname) {
        var hostparts = this.hostname.split(/\./);
        for (var i = 0, l = hostparts.length;i < l; i++) {
          var part = hostparts[i];
          if (!part)
            continue;
          if (!part.match(hostnamePartPattern)) {
            var newpart = "";
            for (var j = 0, k = part.length;j < k; j++)
              if (part.charCodeAt(j) > 127)
                newpart += "x";
              else
                newpart += part[j];
            if (!newpart.match(hostnamePartPattern)) {
              var validParts = hostparts.slice(0, i), notHost = hostparts.slice(i + 1), bit = part.match(hostnamePartStart);
              if (bit)
                validParts.push(bit[1]), notHost.unshift(bit[2]);
              if (notHost.length)
                rest = "/" + notHost.join(".") + rest;
              this.hostname = validParts.join(".");
              break;
            }
          }
        }
      }
      if (this.hostname.length > hostnameMaxLen)
        this.hostname = "";
      else
        this.hostname = this.hostname.toLowerCase();
      if (!ipv6Hostname)
        this.hostname = new URL2(`https://${this.hostname}`).hostname;
      var p = this.port ? ":" + this.port : "", h = this.hostname || "";
      if (this.host = h + p, this.href += this.host, ipv6Hostname) {
        if (this.hostname = this.hostname.substr(1, this.hostname.length - 2), rest[0] !== "/")
          rest = "/" + rest;
      }
    }
    if (!unsafeProtocol[lowerProto])
      for (var i = 0, l = autoEscape.length;i < l; i++) {
        var ae = autoEscape[i];
        if (rest.indexOf(ae) === -1)
          continue;
        var esc = encodeURIComponent(ae);
        if (esc === ae)
          esc = escape(ae);
        rest = rest.split(ae).join(esc);
      }
    var hash = rest.indexOf("#");
    if (hash !== -1)
      this.hash = rest.substr(hash), rest = rest.slice(0, hash);
    var qm = rest.indexOf("?");
    if (qm !== -1) {
      if (this.search = rest.substr(qm), this.query = rest.substr(qm + 1), parseQueryString)
        this.query = querystring.parse(this.query);
      rest = rest.slice(0, qm);
    } else if (parseQueryString)
      this.search = "", this.query = {};
    if (rest)
      this.pathname = rest;
    if (slashedProtocol[lowerProto] && this.hostname && !this.pathname)
      this.pathname = "/";
    if (this.pathname || this.search) {
      var p = this.pathname || "", s = this.search || "";
      this.path = p + s;
    }
    return this.href = this.format(), this;
  };
  Url.prototype.format = function() {
    var auth = this.auth || "";
    if (auth)
      auth = encodeURIComponent(auth), auth = auth.replace(/%3A/i, ":"), auth += "@";
    var protocol = this.protocol || "", pathname = this.pathname || "", hash = this.hash || "", host = false, query = "";
    if (this.host)
      host = auth + this.host;
    else if (this.hostname) {
      if (host = auth + (this.hostname.indexOf(":") === -1 ? this.hostname : "[" + this.hostname + "]"), this.port)
        host += ":" + this.port;
    }
    if (this.query && util_isObject(this.query) && Object.keys(this.query).length)
      query = querystring.stringify(this.query);
    var search = this.search || query && "?" + query || "";
    if (protocol && protocol.substr(-1) !== ":")
      protocol += ":";
    if (this.slashes || (!protocol || slashedProtocol[protocol]) && host !== false) {
      if (host = "//" + (host || ""), pathname && pathname.charAt(0) !== "/")
        pathname = "/" + pathname;
    } else if (!host)
      host = "";
    if (hash && hash.charAt(0) !== "#")
      hash = "#" + hash;
    if (search && search.charAt(0) !== "?")
      search = "?" + search;
    return pathname = pathname.replace(/[?#]/g, function(match) {
      return encodeURIComponent(match);
    }), search = search.replace("#", "%23"), protocol + host + pathname + search + hash;
  };
  Url.prototype.resolve = function(relative) {
    return this.resolveObject(urlParse(relative, false, true)).format();
  };
  Url.prototype.resolveObject = function(relative) {
    if (util_isString(relative)) {
      var rel = new Url;
      rel.parse(relative, false, true), relative = rel;
    }
    var result = new Url, tkeys = Object.keys(this);
    for (var tk = 0;tk < tkeys.length; tk++) {
      var tkey = tkeys[tk];
      result[tkey] = this[tkey];
    }
    if (result.hash = relative.hash, relative.href === "")
      return result.href = result.format(), result;
    if (relative.slashes && !relative.protocol) {
      var rkeys = Object.keys(relative);
      for (var rk = 0;rk < rkeys.length; rk++) {
        var rkey = rkeys[rk];
        if (rkey !== "protocol")
          result[rkey] = relative[rkey];
      }
      if (slashedProtocol[result.protocol] && result.hostname && !result.pathname)
        result.path = result.pathname = "/";
      return result.href = result.format(), result;
    }
    if (relative.protocol && relative.protocol !== result.protocol) {
      if (!slashedProtocol[relative.protocol]) {
        var keys = Object.keys(relative);
        for (var v = 0;v < keys.length; v++) {
          var k = keys[v];
          result[k] = relative[k];
        }
        return result.href = result.format(), result;
      }
      if (result.protocol = relative.protocol, !relative.host && !hostlessProtocol[relative.protocol]) {
        var relPath = (relative.pathname || "").split("/");
        while (relPath.length && !(relative.host = relPath.shift()))
          ;
        if (!relative.host)
          relative.host = "";
        if (!relative.hostname)
          relative.hostname = "";
        if (relPath[0] !== "")
          relPath.unshift("");
        if (relPath.length < 2)
          relPath.unshift("");
        result.pathname = relPath.join("/");
      } else
        result.pathname = relative.pathname;
      if (result.search = relative.search, result.query = relative.query, result.host = relative.host || "", result.auth = relative.auth, result.hostname = relative.hostname || relative.host, result.port = relative.port, result.pathname || result.search) {
        var p = result.pathname || "", s = result.search || "";
        result.path = p + s;
      }
      return result.slashes = result.slashes || relative.slashes, result.href = result.format(), result;
    }
    var isSourceAbs = result.pathname && result.pathname.charAt(0) === "/", isRelAbs = relative.host || relative.pathname && relative.pathname.charAt(0) === "/", mustEndAbs = isRelAbs || isSourceAbs || result.host && relative.pathname, removeAllDots = mustEndAbs, srcPath = result.pathname && result.pathname.split("/") || [], relPath = relative.pathname && relative.pathname.split("/") || [], psychotic = result.protocol && !slashedProtocol[result.protocol];
    if (psychotic) {
      if (result.hostname = "", result.port = null, result.host)
        if (srcPath[0] === "")
          srcPath[0] = result.host;
        else
          srcPath.unshift(result.host);
      if (result.host = "", relative.protocol) {
        if (relative.hostname = null, relative.port = null, relative.host)
          if (relPath[0] === "")
            relPath[0] = relative.host;
          else
            relPath.unshift(relative.host);
        relative.host = null;
      }
      mustEndAbs = mustEndAbs && (relPath[0] === "" || srcPath[0] === "");
    }
    if (isRelAbs)
      result.host = relative.host || relative.host === "" ? relative.host : result.host, result.hostname = relative.hostname || relative.hostname === "" ? relative.hostname : result.hostname, result.search = relative.search, result.query = relative.query, srcPath = relPath;
    else if (relPath.length) {
      if (!srcPath)
        srcPath = [];
      srcPath.pop(), srcPath = srcPath.concat(relPath), result.search = relative.search, result.query = relative.query;
    } else if (!util_isNullOrUndefined(relative.search)) {
      if (psychotic) {
        result.hostname = result.host = srcPath.shift();
        var authInHost = result.host && result.host.indexOf("@") > 0 ? result.host.split("@") : false;
        if (authInHost)
          result.auth = authInHost.shift(), result.host = result.hostname = authInHost.shift();
      }
      if (result.search = relative.search, result.query = relative.query, !util_isNull(result.pathname) || !util_isNull(result.search))
        result.path = (result.pathname ? result.pathname : "") + (result.search ? result.search : "");
      return result.href = result.format(), result;
    }
    if (!srcPath.length) {
      if (result.pathname = null, result.search)
        result.path = "/" + result.search;
      else
        result.path = null;
      return result.href = result.format(), result;
    }
    var last = srcPath.slice(-1)[0], hasTrailingSlash = (result.host || relative.host || srcPath.length > 1) && (last === "." || last === "..") || last === "", up = 0;
    for (var i = srcPath.length;i >= 0; i--)
      if (last = srcPath[i], last === ".")
        srcPath.splice(i, 1);
      else if (last === "..")
        srcPath.splice(i, 1), up++;
      else if (up)
        srcPath.splice(i, 1), up--;
    if (!mustEndAbs && !removeAllDots)
      for (;up--; up)
        srcPath.unshift("..");
    if (mustEndAbs && srcPath[0] !== "" && (!srcPath[0] || srcPath[0].charAt(0) !== "/"))
      srcPath.unshift("");
    if (hasTrailingSlash && srcPath.join("/").substr(-1) !== "/")
      srcPath.push("");
    var isAbsolute = srcPath[0] === "" || srcPath[0] && srcPath[0].charAt(0) === "/";
    if (psychotic) {
      result.hostname = result.host = isAbsolute ? "" : srcPath.length ? srcPath.shift() : "";
      var authInHost = result.host && result.host.indexOf("@") > 0 ? result.host.split("@") : false;
      if (authInHost)
        result.auth = authInHost.shift(), result.host = result.hostname = authInHost.shift();
    }
    if (mustEndAbs = mustEndAbs || result.host && srcPath.length, mustEndAbs && !isAbsolute)
      srcPath.unshift("");
    if (!srcPath.length)
      result.pathname = null, result.path = null;
    else
      result.pathname = srcPath.join("/");
    if (!util_isNull(result.pathname) || !util_isNull(result.search))
      result.path = (result.pathname ? result.pathname : "") + (result.search ? result.search : "");
    return result.auth = relative.auth || result.auth, result.slashes = result.slashes || relative.slashes, result.href = result.format(), result;
  };
  Url.prototype.parseHost = function() {
    var host = this.host, port = portPattern.exec(host);
    if (port) {
      if (port = port[0], port !== ":")
        this.port = port.substr(1);
      host = host.substr(0, host.length - port.length);
    }
    if (host)
      this.hostname = host;
  };
  url_default = { parse: urlParse, resolve: urlResolve, resolveObject: urlResolveObject, format: urlFormat, Url, URL: URL2, URLSearchParams };
});

// node_modules/wasmoon/dist/index.js
var require_dist = __commonJS((exports, module) => {
  var __filename = "wasmoon/dist/index.js";
  (function(global, factory) {
    typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(["exports"], factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, factory(global.wasmoon = {}));
  })(exports, function(exports2) {
    var _documentCurrentScript = typeof document !== "undefined" ? document.currentScript : null;
    exports2.LuaReturn = undefined;
    (function(LuaReturn) {
      LuaReturn[LuaReturn["Ok"] = 0] = "Ok";
      LuaReturn[LuaReturn["Yield"] = 1] = "Yield";
      LuaReturn[LuaReturn["ErrorRun"] = 2] = "ErrorRun";
      LuaReturn[LuaReturn["ErrorSyntax"] = 3] = "ErrorSyntax";
      LuaReturn[LuaReturn["ErrorMem"] = 4] = "ErrorMem";
      LuaReturn[LuaReturn["ErrorErr"] = 5] = "ErrorErr";
      LuaReturn[LuaReturn["ErrorFile"] = 6] = "ErrorFile";
    })(exports2.LuaReturn || (exports2.LuaReturn = {}));
    const PointerSize = 4;
    const LUA_MULTRET = -1;
    const LUAI_MAXSTACK = 1e6;
    const LUA_REGISTRYINDEX = -LUAI_MAXSTACK - 1000;
    exports2.LuaType = undefined;
    (function(LuaType) {
      LuaType[LuaType["None"] = -1] = "None";
      LuaType[LuaType["Nil"] = 0] = "Nil";
      LuaType[LuaType["Boolean"] = 1] = "Boolean";
      LuaType[LuaType["LightUserdata"] = 2] = "LightUserdata";
      LuaType[LuaType["Number"] = 3] = "Number";
      LuaType[LuaType["String"] = 4] = "String";
      LuaType[LuaType["Table"] = 5] = "Table";
      LuaType[LuaType["Function"] = 6] = "Function";
      LuaType[LuaType["Userdata"] = 7] = "Userdata";
      LuaType[LuaType["Thread"] = 8] = "Thread";
    })(exports2.LuaType || (exports2.LuaType = {}));
    exports2.LuaEventCodes = undefined;
    (function(LuaEventCodes) {
      LuaEventCodes[LuaEventCodes["Call"] = 0] = "Call";
      LuaEventCodes[LuaEventCodes["Ret"] = 1] = "Ret";
      LuaEventCodes[LuaEventCodes["Line"] = 2] = "Line";
      LuaEventCodes[LuaEventCodes["Count"] = 3] = "Count";
      LuaEventCodes[LuaEventCodes["TailCall"] = 4] = "TailCall";
    })(exports2.LuaEventCodes || (exports2.LuaEventCodes = {}));
    exports2.LuaEventMasks = undefined;
    (function(LuaEventMasks) {
      LuaEventMasks[LuaEventMasks["Call"] = 1] = "Call";
      LuaEventMasks[LuaEventMasks["Ret"] = 2] = "Ret";
      LuaEventMasks[LuaEventMasks["Line"] = 4] = "Line";
      LuaEventMasks[LuaEventMasks["Count"] = 8] = "Count";
    })(exports2.LuaEventMasks || (exports2.LuaEventMasks = {}));
    exports2.LuaLibraries = undefined;
    (function(LuaLibraries) {
      LuaLibraries["Base"] = "_G";
      LuaLibraries["Coroutine"] = "coroutine";
      LuaLibraries["Table"] = "table";
      LuaLibraries["IO"] = "io";
      LuaLibraries["OS"] = "os";
      LuaLibraries["String"] = "string";
      LuaLibraries["UTF8"] = "utf8";
      LuaLibraries["Math"] = "math";
      LuaLibraries["Debug"] = "debug";
      LuaLibraries["Package"] = "package";
    })(exports2.LuaLibraries || (exports2.LuaLibraries = {}));

    class LuaTimeoutError extends Error {
    }

    class Decoration {
      constructor(target, options) {
        this.target = target;
        this.options = options;
      }
    }
    function decorate(target, options) {
      return new Decoration(target, options);
    }

    class Pointer extends Number {
    }

    class MultiReturn extends Array {
    }
    const INSTRUCTION_HOOK_COUNT = 1000;

    class Thread {
      constructor(lua, typeExtensions, address, parent) {
        this.closed = false;
        this.lua = lua;
        this.typeExtensions = typeExtensions;
        this.address = address;
        this.parent = parent;
      }
      newThread() {
        const address = this.lua.lua_newthread(this.address);
        if (!address) {
          throw new Error("lua_newthread returned a null pointer");
        }
        return new Thread(this.lua, this.typeExtensions, address, this.parent || this);
      }
      resetThread() {
        this.assertOk(this.lua.lua_resetthread(this.address));
      }
      loadString(luaCode, name) {
        const size = this.lua.module.lengthBytesUTF8(luaCode);
        const pointerSize = size + 1;
        const bufferPointer = this.lua.module._malloc(pointerSize);
        try {
          this.lua.module.stringToUTF8(luaCode, bufferPointer, pointerSize);
          this.assertOk(this.lua.luaL_loadbufferx(this.address, bufferPointer, size, name !== null && name !== undefined ? name : bufferPointer, null));
        } finally {
          this.lua.module._free(bufferPointer);
        }
      }
      loadFile(filename) {
        this.assertOk(this.lua.luaL_loadfilex(this.address, filename, null));
      }
      resume(argCount = 0) {
        const dataPointer = this.lua.module._malloc(PointerSize);
        try {
          this.lua.module.setValue(dataPointer, 0, "i32");
          const luaResult = this.lua.lua_resume(this.address, null, argCount, dataPointer);
          return {
            result: luaResult,
            resultCount: this.lua.module.getValue(dataPointer, "i32")
          };
        } finally {
          this.lua.module._free(dataPointer);
        }
      }
      getTop() {
        return this.lua.lua_gettop(this.address);
      }
      setTop(index) {
        this.lua.lua_settop(this.address, index);
      }
      remove(index) {
        return this.lua.lua_remove(this.address, index);
      }
      setField(index, name, value) {
        index = this.lua.lua_absindex(this.address, index);
        this.pushValue(value);
        this.lua.lua_setfield(this.address, index, name);
      }
      async run(argCount = 0, options) {
        const originalTimeout = this.timeout;
        try {
          if ((options === null || options === undefined ? undefined : options.timeout) !== undefined) {
            this.setTimeout(Date.now() + options.timeout);
          }
          let resumeResult = this.resume(argCount);
          while (resumeResult.result === exports2.LuaReturn.Yield) {
            if (this.timeout && Date.now() > this.timeout) {
              if (resumeResult.resultCount > 0) {
                this.pop(resumeResult.resultCount);
              }
              throw new LuaTimeoutError(`thread timeout exceeded`);
            }
            if (resumeResult.resultCount > 0) {
              const lastValue = this.getValue(-1);
              this.pop(resumeResult.resultCount);
              if (lastValue === Promise.resolve(lastValue)) {
                await lastValue;
              } else {
                await new Promise((resolve) => setImmediate(resolve));
              }
            } else {
              await new Promise((resolve) => setImmediate(resolve));
            }
            resumeResult = this.resume(0);
          }
          this.assertOk(resumeResult.result);
          return this.getStackValues();
        } finally {
          if ((options === null || options === undefined ? undefined : options.timeout) !== undefined) {
            this.setTimeout(originalTimeout);
          }
        }
      }
      runSync(argCount = 0) {
        const base = this.getTop() - argCount - 1;
        this.assertOk(this.lua.lua_pcallk(this.address, argCount, LUA_MULTRET, 0, 0, null));
        return this.getStackValues(base);
      }
      pop(count = 1) {
        this.lua.lua_pop(this.address, count);
      }
      call(name, ...args) {
        const type = this.lua.lua_getglobal(this.address, name);
        if (type !== exports2.LuaType.Function) {
          throw new Error(`A function of type '${type}' was pushed, expected is ${exports2.LuaType.Function}`);
        }
        for (const arg of args) {
          this.pushValue(arg);
        }
        const base = this.getTop() - args.length - 1;
        this.lua.lua_callk(this.address, args.length, LUA_MULTRET, 0, null);
        return this.getStackValues(base);
      }
      getStackValues(start = 0) {
        const returns = this.getTop() - start;
        const returnValues = new MultiReturn(returns);
        for (let i = 0;i < returns; i++) {
          returnValues[i] = this.getValue(start + i + 1);
        }
        return returnValues;
      }
      stateToThread(L) {
        var _a;
        return L === ((_a = this.parent) === null || _a === undefined ? undefined : _a.address) ? this.parent : new Thread(this.lua, this.typeExtensions, L, this.parent || this);
      }
      pushValue(rawValue, userdata) {
        const decoratedValue = this.getValueDecorations(rawValue);
        const target = decoratedValue.target;
        if (target instanceof Thread) {
          const isMain = this.lua.lua_pushthread(target.address) === 1;
          if (!isMain) {
            this.lua.lua_xmove(target.address, this.address, 1);
          }
          return;
        }
        const startTop = this.getTop();
        switch (typeof target) {
          case "undefined":
            this.lua.lua_pushnil(this.address);
            break;
          case "number":
            if (Number.isInteger(target)) {
              this.lua.lua_pushinteger(this.address, BigInt(target));
            } else {
              this.lua.lua_pushnumber(this.address, target);
            }
            break;
          case "string":
            this.lua.lua_pushstring(this.address, target);
            break;
          case "boolean":
            this.lua.lua_pushboolean(this.address, target ? 1 : 0);
            break;
          default:
            if (!this.typeExtensions.find((wrapper) => wrapper.extension.pushValue(this, decoratedValue, userdata))) {
              throw new Error(`The type '${typeof target}' is not supported by Lua`);
            }
        }
        if (decoratedValue.options.metatable) {
          this.setMetatable(-1, decoratedValue.options.metatable);
        }
        if (this.getTop() !== startTop + 1) {
          throw new Error(`pushValue expected stack size ${startTop + 1}, got ${this.getTop()}`);
        }
      }
      setMetatable(index, metatable) {
        index = this.lua.lua_absindex(this.address, index);
        if (this.lua.lua_getmetatable(this.address, index)) {
          this.pop(1);
          const name = this.getMetatableName(index);
          throw new Error(`data already has associated metatable: ${name || "unknown name"}`);
        }
        this.pushValue(metatable);
        this.lua.lua_setmetatable(this.address, index);
      }
      getMetatableName(index) {
        const metatableNameType = this.lua.luaL_getmetafield(this.address, index, "__name");
        if (metatableNameType === exports2.LuaType.Nil) {
          return;
        }
        if (metatableNameType !== exports2.LuaType.String) {
          this.pop(1);
          return;
        }
        const name = this.lua.lua_tolstring(this.address, -1, null);
        this.pop(1);
        return name;
      }
      getValue(index, inputType, userdata) {
        index = this.lua.lua_absindex(this.address, index);
        const type = inputType !== null && inputType !== undefined ? inputType : this.lua.lua_type(this.address, index);
        switch (type) {
          case exports2.LuaType.None:
            return;
          case exports2.LuaType.Nil:
            return null;
          case exports2.LuaType.Number:
            return this.lua.lua_tonumberx(this.address, index, null);
          case exports2.LuaType.String:
            return this.lua.lua_tolstring(this.address, index, null);
          case exports2.LuaType.Boolean:
            return Boolean(this.lua.lua_toboolean(this.address, index));
          case exports2.LuaType.Thread:
            return this.stateToThread(this.lua.lua_tothread(this.address, index));
          default: {
            let metatableName;
            if (type === exports2.LuaType.Table || type === exports2.LuaType.Userdata) {
              metatableName = this.getMetatableName(index);
            }
            const typeExtensionWrapper = this.typeExtensions.find((wrapper) => wrapper.extension.isType(this, index, type, metatableName));
            if (typeExtensionWrapper) {
              return typeExtensionWrapper.extension.getValue(this, index, userdata);
            }
            console.warn(`The type '${this.lua.lua_typename(this.address, type)}' returned is not supported on JS`);
            return new Pointer(this.lua.lua_topointer(this.address, index));
          }
        }
      }
      close() {
        if (this.isClosed()) {
          return;
        }
        if (this.hookFunctionPointer) {
          this.lua.module.removeFunction(this.hookFunctionPointer);
        }
        this.closed = true;
      }
      setTimeout(timeout) {
        if (timeout && timeout > 0) {
          if (!this.hookFunctionPointer) {
            this.hookFunctionPointer = this.lua.module.addFunction(() => {
              if (Date.now() > timeout) {
                this.pushValue(new LuaTimeoutError(`thread timeout exceeded`));
                this.lua.lua_error(this.address);
              }
            }, "vii");
          }
          this.lua.lua_sethook(this.address, this.hookFunctionPointer, exports2.LuaEventMasks.Count, INSTRUCTION_HOOK_COUNT);
          this.timeout = timeout;
        } else if (this.hookFunctionPointer) {
          this.hookFunctionPointer = undefined;
          this.timeout = undefined;
          this.lua.lua_sethook(this.address, null, 0, 0);
        }
      }
      getTimeout() {
        return this.timeout;
      }
      getPointer(index) {
        return new Pointer(this.lua.lua_topointer(this.address, index));
      }
      isClosed() {
        var _a;
        return !this.address || this.closed || Boolean((_a = this.parent) === null || _a === undefined ? undefined : _a.isClosed());
      }
      indexToString(index) {
        const str = this.lua.luaL_tolstring(this.address, index, null);
        this.pop();
        return str;
      }
      dumpStack(log = console.log) {
        const top = this.getTop();
        for (let i = 1;i <= top; i++) {
          const type = this.lua.lua_type(this.address, i);
          const typename = this.lua.lua_typename(this.address, type);
          const pointer = this.getPointer(i);
          const name = this.indexToString(i);
          const value = this.getValue(i, type);
          log(i, typename, pointer, name, value);
        }
      }
      assertOk(result) {
        if (result !== exports2.LuaReturn.Ok && result !== exports2.LuaReturn.Yield) {
          const resultString = exports2.LuaReturn[result];
          const error = new Error(`Lua Error(${resultString}/${result})`);
          if (this.getTop() > 0) {
            if (result === exports2.LuaReturn.ErrorMem) {
              error.message = this.lua.lua_tolstring(this.address, -1, null);
            } else {
              const luaError = this.getValue(-1);
              if (luaError instanceof Error) {
                error.stack = luaError.stack;
              }
              error.message = this.indexToString(-1);
            }
          }
          if (result !== exports2.LuaReturn.ErrorMem) {
            try {
              this.lua.luaL_traceback(this.address, this.address, null, 1);
              const traceback = this.lua.lua_tolstring(this.address, -1, null);
              if (traceback.trim() !== "stack traceback:") {
                error.message = `${error.message}
${traceback}`;
              }
              this.pop(1);
            } catch (err) {
              console.warn("Failed to generate stack trace", err);
            }
          }
          throw error;
        }
      }
      getValueDecorations(value) {
        return value instanceof Decoration ? value : new Decoration(value, {});
      }
    }

    class Global extends Thread {
      constructor(cmodule, shouldTraceAllocations) {
        if (shouldTraceAllocations) {
          const memoryStats = { memoryUsed: 0 };
          const allocatorFunctionPointer = cmodule.module.addFunction((_userData, pointer, oldSize, newSize) => {
            if (newSize === 0) {
              if (pointer) {
                memoryStats.memoryUsed -= oldSize;
                cmodule.module._free(pointer);
              }
              return 0;
            }
            const endMemoryDelta = pointer ? newSize - oldSize : newSize;
            const endMemory = memoryStats.memoryUsed + endMemoryDelta;
            if (newSize > oldSize && memoryStats.memoryMax && endMemory > memoryStats.memoryMax) {
              return 0;
            }
            const reallocated = cmodule.module._realloc(pointer, newSize);
            if (reallocated) {
              memoryStats.memoryUsed = endMemory;
            }
            return reallocated;
          }, "iiiii");
          const address = cmodule.lua_newstate(allocatorFunctionPointer, null);
          if (!address) {
            cmodule.module.removeFunction(allocatorFunctionPointer);
            throw new Error("lua_newstate returned a null pointer");
          }
          super(cmodule, [], address);
          this.memoryStats = memoryStats;
          this.allocatorFunctionPointer = allocatorFunctionPointer;
        } else {
          super(cmodule, [], cmodule.luaL_newstate());
        }
        if (this.isClosed()) {
          throw new Error("Global state could not be created (probably due to lack of memory)");
        }
      }
      close() {
        if (this.isClosed()) {
          return;
        }
        super.close();
        this.lua.lua_close(this.address);
        if (this.allocatorFunctionPointer) {
          this.lua.module.removeFunction(this.allocatorFunctionPointer);
        }
        for (const wrapper of this.typeExtensions) {
          wrapper.extension.close();
        }
      }
      registerTypeExtension(priority, extension) {
        this.typeExtensions.push({ extension, priority });
        this.typeExtensions.sort((a, b) => b.priority - a.priority);
      }
      loadLibrary(library) {
        switch (library) {
          case exports2.LuaLibraries.Base:
            this.lua.luaopen_base(this.address);
            break;
          case exports2.LuaLibraries.Coroutine:
            this.lua.luaopen_coroutine(this.address);
            break;
          case exports2.LuaLibraries.Table:
            this.lua.luaopen_table(this.address);
            break;
          case exports2.LuaLibraries.IO:
            this.lua.luaopen_io(this.address);
            break;
          case exports2.LuaLibraries.OS:
            this.lua.luaopen_os(this.address);
            break;
          case exports2.LuaLibraries.String:
            this.lua.luaopen_string(this.address);
            break;
          case exports2.LuaLibraries.UTF8:
            this.lua.luaopen_string(this.address);
            break;
          case exports2.LuaLibraries.Math:
            this.lua.luaopen_math(this.address);
            break;
          case exports2.LuaLibraries.Debug:
            this.lua.luaopen_debug(this.address);
            break;
          case exports2.LuaLibraries.Package:
            this.lua.luaopen_package(this.address);
            break;
        }
        this.lua.lua_setglobal(this.address, library);
      }
      get(name) {
        const type = this.lua.lua_getglobal(this.address, name);
        const value = this.getValue(-1, type);
        this.pop();
        return value;
      }
      set(name, value) {
        this.pushValue(value);
        this.lua.lua_setglobal(this.address, name);
      }
      getTable(name, callback) {
        const startStackTop = this.getTop();
        const type = this.lua.lua_getglobal(this.address, name);
        try {
          if (type !== exports2.LuaType.Table) {
            throw new TypeError(`Unexpected type in ${name}. Expected ${exports2.LuaType[exports2.LuaType.Table]}. Got ${exports2.LuaType[type]}.`);
          }
          callback(startStackTop + 1);
        } finally {
          if (this.getTop() !== startStackTop + 1) {
            console.warn(`getTable: expected stack size ${startStackTop} got ${this.getTop()}`);
          }
          this.setTop(startStackTop);
        }
      }
      getMemoryUsed() {
        return this.getMemoryStatsRef().memoryUsed;
      }
      getMemoryMax() {
        return this.getMemoryStatsRef().memoryMax;
      }
      setMemoryMax(max) {
        this.getMemoryStatsRef().memoryMax = max;
      }
      getMemoryStatsRef() {
        if (!this.memoryStats) {
          throw new Error("Memory allocations is not being traced, please build engine with { traceAllocations: true }");
        }
        return this.memoryStats;
      }
    }

    class LuaTypeExtension {
      constructor(thread, name) {
        this.thread = thread;
        this.name = name;
      }
      isType(_thread, _index, type, name) {
        return type === exports2.LuaType.Userdata && name === this.name;
      }
      getValue(thread, index, _userdata) {
        const refUserdata = thread.lua.luaL_testudata(thread.address, index, this.name);
        if (!refUserdata) {
          throw new Error(`data does not have the expected metatable: ${this.name}`);
        }
        const referencePointer = thread.lua.module.getValue(refUserdata, "*");
        return thread.lua.getRef(referencePointer);
      }
      pushValue(thread, decoratedValue, _userdata) {
        const { target } = decoratedValue;
        const pointer = thread.lua.ref(target);
        const userDataPointer = thread.lua.lua_newuserdatauv(thread.address, PointerSize, 0);
        thread.lua.module.setValue(userDataPointer, pointer, "*");
        if (exports2.LuaType.Nil === thread.lua.luaL_getmetatable(thread.address, this.name)) {
          thread.pop(2);
          throw new Error(`metatable not found: ${this.name}`);
        }
        thread.lua.lua_setmetatable(thread.address, -2);
        return true;
      }
    }

    class ErrorTypeExtension extends LuaTypeExtension {
      constructor(thread, injectObject) {
        super(thread, "js_error");
        this.gcPointer = thread.lua.module.addFunction((functionStateAddress) => {
          const userDataPointer = thread.lua.luaL_checkudata(functionStateAddress, 1, this.name);
          const referencePointer = thread.lua.module.getValue(userDataPointer, "*");
          thread.lua.unref(referencePointer);
          return exports2.LuaReturn.Ok;
        }, "ii");
        if (thread.lua.luaL_newmetatable(thread.address, this.name)) {
          const metatableIndex = thread.lua.lua_gettop(thread.address);
          thread.lua.lua_pushstring(thread.address, "protected metatable");
          thread.lua.lua_setfield(thread.address, metatableIndex, "__metatable");
          thread.lua.lua_pushcclosure(thread.address, this.gcPointer, 0);
          thread.lua.lua_setfield(thread.address, metatableIndex, "__gc");
          thread.pushValue((jsRefError, key) => {
            if (key === "message") {
              return jsRefError.message;
            }
            return null;
          });
          thread.lua.lua_setfield(thread.address, metatableIndex, "__index");
          thread.pushValue((jsRefError) => {
            return jsRefError.message;
          });
          thread.lua.lua_setfield(thread.address, metatableIndex, "__tostring");
        }
        thread.lua.lua_pop(thread.address, 1);
        if (injectObject) {
          thread.set("Error", {
            create: (message) => {
              if (message && typeof message !== "string") {
                throw new Error("message must be a string");
              }
              return new Error(message);
            }
          });
        }
      }
      pushValue(thread, decoration) {
        if (!(decoration.target instanceof Error)) {
          return false;
        }
        return super.pushValue(thread, decoration);
      }
      close() {
        this.thread.lua.module.removeFunction(this.gcPointer);
      }
    }
    function createTypeExtension$6(thread, injectObject) {
      return new ErrorTypeExtension(thread, injectObject);
    }

    class RawResult {
      constructor(count) {
        this.count = count;
      }
    }
    function decorateFunction(target, options) {
      return new Decoration(target, options);
    }

    class FunctionTypeExtension extends LuaTypeExtension {
      constructor(thread, options) {
        super(thread, "js_function");
        this.functionRegistry = typeof FinalizationRegistry !== "undefined" ? new FinalizationRegistry((func) => {
          if (!this.thread.isClosed()) {
            this.thread.lua.luaL_unref(this.thread.address, LUA_REGISTRYINDEX, func);
          }
        }) : undefined;
        this.options = options;
        this.callbackContext = thread.newThread();
        this.callbackContextIndex = this.thread.lua.luaL_ref(thread.address, LUA_REGISTRYINDEX);
        if (!this.functionRegistry) {
          console.warn("FunctionTypeExtension: FinalizationRegistry not found. Memory leaks likely.");
        }
        this.gcPointer = thread.lua.module.addFunction((calledL) => {
          thread.lua.luaL_checkudata(calledL, 1, this.name);
          const userDataPointer = thread.lua.luaL_checkudata(calledL, 1, this.name);
          const referencePointer = thread.lua.module.getValue(userDataPointer, "*");
          thread.lua.unref(referencePointer);
          return exports2.LuaReturn.Ok;
        }, "ii");
        if (thread.lua.luaL_newmetatable(thread.address, this.name)) {
          thread.lua.lua_pushstring(thread.address, "__gc");
          thread.lua.lua_pushcclosure(thread.address, this.gcPointer, 0);
          thread.lua.lua_settable(thread.address, -3);
          thread.lua.lua_pushstring(thread.address, "__metatable");
          thread.lua.lua_pushstring(thread.address, "protected metatable");
          thread.lua.lua_settable(thread.address, -3);
        }
        thread.lua.lua_pop(thread.address, 1);
        this.functionWrapper = thread.lua.module.addFunction((calledL) => {
          const calledThread = thread.stateToThread(calledL);
          const refUserdata = thread.lua.luaL_checkudata(calledL, thread.lua.lua_upvalueindex(1), this.name);
          const refPointer = thread.lua.module.getValue(refUserdata, "*");
          const { target, options: options2 } = thread.lua.getRef(refPointer);
          const argsQuantity = calledThread.getTop();
          const args = [];
          if (options2.receiveThread) {
            args.push(calledThread);
          }
          if (options2.receiveArgsQuantity) {
            args.push(argsQuantity);
          } else {
            for (let i = 1;i <= argsQuantity; i++) {
              const value = calledThread.getValue(i);
              if (i !== 1 || !(options2 === null || options2 === undefined ? undefined : options2.self) || value !== options2.self) {
                args.push(value);
              }
            }
          }
          try {
            const result = target.apply(options2 === null || options2 === undefined ? undefined : options2.self, args);
            if (result === undefined) {
              return 0;
            } else if (result instanceof RawResult) {
              return result.count;
            } else if (result instanceof MultiReturn) {
              for (const item of result) {
                calledThread.pushValue(item);
              }
              return result.length;
            } else {
              calledThread.pushValue(result);
              return 1;
            }
          } catch (err) {
            if (err === Infinity) {
              throw err;
            }
            calledThread.pushValue(err);
            return calledThread.lua.lua_error(calledThread.address);
          }
        }, "ii");
      }
      close() {
        this.thread.lua.module.removeFunction(this.gcPointer);
        this.thread.lua.module.removeFunction(this.functionWrapper);
        this.callbackContext.close();
        this.callbackContext.lua.luaL_unref(this.callbackContext.address, LUA_REGISTRYINDEX, this.callbackContextIndex);
      }
      isType(_thread, _index, type) {
        return type === exports2.LuaType.Function;
      }
      pushValue(thread, decoration) {
        if (typeof decoration.target !== "function") {
          return false;
        }
        const pointer = thread.lua.ref(decoration);
        const userDataPointer = thread.lua.lua_newuserdatauv(thread.address, PointerSize, 0);
        thread.lua.module.setValue(userDataPointer, pointer, "*");
        if (exports2.LuaType.Nil === thread.lua.luaL_getmetatable(thread.address, this.name)) {
          thread.pop(1);
          thread.lua.unref(pointer);
          throw new Error(`metatable not found: ${this.name}`);
        }
        thread.lua.lua_setmetatable(thread.address, -2);
        thread.lua.lua_pushcclosure(thread.address, this.functionWrapper, 1);
        return true;
      }
      getValue(thread, index) {
        var _a;
        thread.lua.lua_pushvalue(thread.address, index);
        const func = thread.lua.luaL_ref(thread.address, LUA_REGISTRYINDEX);
        const jsFunc = (...args) => {
          var _a2;
          if (this.callbackContext.isClosed()) {
            console.warn("Tried to call a function after closing lua state");
            return;
          }
          const callThread = this.callbackContext.newThread();
          try {
            const internalType = callThread.lua.lua_rawgeti(callThread.address, LUA_REGISTRYINDEX, BigInt(func));
            if (internalType !== exports2.LuaType.Function) {
              const callMetafieldType = callThread.lua.luaL_getmetafield(callThread.address, -1, "__call");
              callThread.pop();
              if (callMetafieldType !== exports2.LuaType.Function) {
                throw new Error(`A value of type '${internalType}' was pushed but it is not callable`);
              }
            }
            for (const arg of args) {
              callThread.pushValue(arg);
            }
            if ((_a2 = this.options) === null || _a2 === undefined ? undefined : _a2.functionTimeout) {
              callThread.setTimeout(Date.now() + this.options.functionTimeout);
            }
            const status = callThread.lua.lua_pcallk(callThread.address, args.length, 1, 0, 0, null);
            if (status === exports2.LuaReturn.Yield) {
              throw new Error("cannot yield in callbacks from javascript");
            }
            callThread.assertOk(status);
            if (callThread.getTop() > 0) {
              return callThread.getValue(-1);
            }
            return;
          } finally {
            callThread.close();
            this.callbackContext.pop();
          }
        };
        (_a = this.functionRegistry) === null || _a === undefined || _a.register(jsFunc, func);
        return jsFunc;
      }
    }
    function createTypeExtension$5(thread, options) {
      return new FunctionTypeExtension(thread, options);
    }

    class NullTypeExtension extends LuaTypeExtension {
      constructor(thread) {
        super(thread, "js_null");
        this.gcPointer = thread.lua.module.addFunction((functionStateAddress) => {
          const userDataPointer = thread.lua.luaL_checkudata(functionStateAddress, 1, this.name);
          const referencePointer = thread.lua.module.getValue(userDataPointer, "*");
          thread.lua.unref(referencePointer);
          return exports2.LuaReturn.Ok;
        }, "ii");
        if (thread.lua.luaL_newmetatable(thread.address, this.name)) {
          const metatableIndex = thread.lua.lua_gettop(thread.address);
          thread.lua.lua_pushstring(thread.address, "protected metatable");
          thread.lua.lua_setfield(thread.address, metatableIndex, "__metatable");
          thread.lua.lua_pushcclosure(thread.address, this.gcPointer, 0);
          thread.lua.lua_setfield(thread.address, metatableIndex, "__gc");
          thread.pushValue(() => null);
          thread.lua.lua_setfield(thread.address, metatableIndex, "__index");
          thread.pushValue(() => "null");
          thread.lua.lua_setfield(thread.address, metatableIndex, "__tostring");
          thread.pushValue((self2, other) => self2 === other);
          thread.lua.lua_setfield(thread.address, metatableIndex, "__eq");
        }
        thread.lua.lua_pop(thread.address, 1);
        super.pushValue(thread, new Decoration({}, {}));
        thread.lua.lua_setglobal(thread.address, "null");
      }
      getValue(thread, index) {
        const refUserData = thread.lua.luaL_testudata(thread.address, index, this.name);
        if (!refUserData) {
          throw new Error(`data does not have the expected metatable: ${this.name}`);
        }
        return null;
      }
      pushValue(thread, decoration) {
        if ((decoration === null || decoration === undefined ? undefined : decoration.target) !== null) {
          return false;
        }
        thread.lua.lua_getglobal(thread.address, "null");
        return true;
      }
      close() {
        this.thread.lua.module.removeFunction(this.gcPointer);
      }
    }
    function createTypeExtension$4(thread) {
      return new NullTypeExtension(thread);
    }

    class PromiseTypeExtension extends LuaTypeExtension {
      constructor(thread, injectObject) {
        super(thread, "js_promise");
        this.gcPointer = thread.lua.module.addFunction((functionStateAddress) => {
          const userDataPointer = thread.lua.luaL_checkudata(functionStateAddress, 1, this.name);
          const referencePointer = thread.lua.module.getValue(userDataPointer, "*");
          thread.lua.unref(referencePointer);
          return exports2.LuaReturn.Ok;
        }, "ii");
        if (thread.lua.luaL_newmetatable(thread.address, this.name)) {
          const metatableIndex = thread.lua.lua_gettop(thread.address);
          thread.lua.lua_pushstring(thread.address, "protected metatable");
          thread.lua.lua_setfield(thread.address, metatableIndex, "__metatable");
          thread.lua.lua_pushcclosure(thread.address, this.gcPointer, 0);
          thread.lua.lua_setfield(thread.address, metatableIndex, "__gc");
          const checkSelf = (self2) => {
            if (Promise.resolve(self2) !== self2 && typeof self2.then !== "function") {
              throw new Error("promise method called without self instance");
            }
            return true;
          };
          thread.pushValue({
            next: (self2, ...args) => checkSelf(self2) && self2.then(...args),
            catch: (self2, ...args) => checkSelf(self2) && self2.catch(...args),
            finally: (self2, ...args) => checkSelf(self2) && self2.finally(...args),
            await: decorateFunction((functionThread, self2) => {
              checkSelf(self2);
              if (functionThread.address === thread.address) {
                throw new Error("cannot await in the main thread");
              }
              let promiseResult = undefined;
              const awaitPromise = self2.then((res) => {
                promiseResult = { status: "fulfilled", value: res };
              }).catch((err) => {
                promiseResult = { status: "rejected", value: err };
              });
              const continuance = this.thread.lua.module.addFunction((continuanceState) => {
                if (!promiseResult) {
                  return thread.lua.lua_yieldk(functionThread.address, 0, 0, continuance);
                }
                this.thread.lua.module.removeFunction(continuance);
                const continuanceThread = thread.stateToThread(continuanceState);
                if (promiseResult.status === "rejected") {
                  continuanceThread.pushValue(promiseResult.value || new Error("promise rejected with no error"));
                  return this.thread.lua.lua_error(continuanceState);
                }
                if (promiseResult.value instanceof RawResult) {
                  return promiseResult.value.count;
                } else if (promiseResult.value instanceof MultiReturn) {
                  for (const arg of promiseResult.value) {
                    continuanceThread.pushValue(arg);
                  }
                  return promiseResult.value.length;
                } else {
                  continuanceThread.pushValue(promiseResult.value);
                  return 1;
                }
              }, "iiii");
              functionThread.pushValue(awaitPromise);
              return new RawResult(thread.lua.lua_yieldk(functionThread.address, 1, 0, continuance));
            }, { receiveThread: true })
          });
          thread.lua.lua_setfield(thread.address, metatableIndex, "__index");
          thread.pushValue((self2, other) => self2 === other);
          thread.lua.lua_setfield(thread.address, metatableIndex, "__eq");
        }
        thread.lua.lua_pop(thread.address, 1);
        if (injectObject) {
          thread.set("Promise", {
            create: (callback) => new Promise(callback),
            all: (promiseArray) => {
              if (!Array.isArray(promiseArray)) {
                throw new Error("argument must be an array of promises");
              }
              return Promise.all(promiseArray.map((potentialPromise) => Promise.resolve(potentialPromise)));
            },
            resolve: (value) => Promise.resolve(value)
          });
        }
      }
      close() {
        this.thread.lua.module.removeFunction(this.gcPointer);
      }
      pushValue(thread, decoration) {
        if (Promise.resolve(decoration.target) !== decoration.target && typeof decoration.target.then !== "function") {
          return false;
        }
        return super.pushValue(thread, decoration);
      }
    }
    function createTypeExtension$3(thread, injectObject) {
      return new PromiseTypeExtension(thread, injectObject);
    }
    function decorateProxy(target, options) {
      return new Decoration(target, options || {});
    }

    class ProxyTypeExtension extends LuaTypeExtension {
      constructor(thread) {
        super(thread, "js_proxy");
        this.gcPointer = thread.lua.module.addFunction((functionStateAddress) => {
          const userDataPointer = thread.lua.luaL_checkudata(functionStateAddress, 1, this.name);
          const referencePointer = thread.lua.module.getValue(userDataPointer, "*");
          thread.lua.unref(referencePointer);
          return exports2.LuaReturn.Ok;
        }, "ii");
        if (thread.lua.luaL_newmetatable(thread.address, this.name)) {
          const metatableIndex = thread.lua.lua_gettop(thread.address);
          thread.lua.lua_pushstring(thread.address, "protected metatable");
          thread.lua.lua_setfield(thread.address, metatableIndex, "__metatable");
          thread.lua.lua_pushcclosure(thread.address, this.gcPointer, 0);
          thread.lua.lua_setfield(thread.address, metatableIndex, "__gc");
          thread.pushValue((self2, key) => {
            switch (typeof key) {
              case "number":
                key = key - 1;
              case "string":
                break;
              default:
                throw new Error("Only strings or numbers can index js objects");
            }
            const value = self2[key];
            if (typeof value === "function") {
              return decorateFunction(value, { self: self2 });
            }
            return value;
          });
          thread.lua.lua_setfield(thread.address, metatableIndex, "__index");
          thread.pushValue((self2, key, value) => {
            switch (typeof key) {
              case "number":
                key = key - 1;
              case "string":
                break;
              default:
                throw new Error("Only strings or numbers can index js objects");
            }
            self2[key] = value;
          });
          thread.lua.lua_setfield(thread.address, metatableIndex, "__newindex");
          thread.pushValue((self2) => {
            var _a, _b;
            return (_b = (_a = self2.toString) === null || _a === undefined ? undefined : _a.call(self2)) !== null && _b !== undefined ? _b : typeof self2;
          });
          thread.lua.lua_setfield(thread.address, metatableIndex, "__tostring");
          thread.pushValue((self2) => {
            return self2.length || 0;
          });
          thread.lua.lua_setfield(thread.address, metatableIndex, "__len");
          thread.pushValue((self2) => {
            const keys = Object.getOwnPropertyNames(self2);
            let i = 0;
            return MultiReturn.of(() => {
              const ret = MultiReturn.of(keys[i], self2[keys[i]]);
              i++;
              return ret;
            }, self2, null);
          });
          thread.lua.lua_setfield(thread.address, metatableIndex, "__pairs");
          thread.pushValue((self2, other) => {
            return self2 === other;
          });
          thread.lua.lua_setfield(thread.address, metatableIndex, "__eq");
          thread.pushValue((self2, ...args) => {
            if (args[0] === self2) {
              args.shift();
            }
            return self2(...args);
          });
          thread.lua.lua_setfield(thread.address, metatableIndex, "__call");
        }
        thread.lua.lua_pop(thread.address, 1);
      }
      isType(_thread, _index, type, name) {
        return type === exports2.LuaType.Userdata && name === this.name;
      }
      getValue(thread, index) {
        const refUserdata = thread.lua.lua_touserdata(thread.address, index);
        const referencePointer = thread.lua.module.getValue(refUserdata, "*");
        return thread.lua.getRef(referencePointer);
      }
      pushValue(thread, decoratedValue) {
        var _a;
        const { target, options } = decoratedValue;
        if (options.proxy === undefined) {
          if (target === null || target === undefined) {
            return false;
          }
          if (typeof target !== "object") {
            const isClass = typeof target === "function" && ((_a = target.prototype) === null || _a === undefined ? undefined : _a.constructor) === target && target.toString().startsWith("class ");
            if (!isClass) {
              return false;
            }
          }
          if (Promise.resolve(target) === target || typeof target.then === "function") {
            return false;
          }
        } else if (options.proxy === false) {
          return false;
        }
        if (options.metatable && !(options.metatable instanceof Decoration)) {
          decoratedValue.options.metatable = decorateProxy(options.metatable, { proxy: false });
          return false;
        }
        return super.pushValue(thread, decoratedValue);
      }
      close() {
        this.thread.lua.module.removeFunction(this.gcPointer);
      }
    }
    function createTypeExtension$2(thread) {
      return new ProxyTypeExtension(thread);
    }

    class TableTypeExtension extends LuaTypeExtension {
      constructor(thread) {
        super(thread, "js_table");
      }
      close() {}
      isType(_thread, _index, type) {
        return type === exports2.LuaType.Table;
      }
      getValue(thread, index, userdata) {
        const seenMap = userdata || new Map;
        const pointer = thread.lua.lua_topointer(thread.address, index);
        let table = seenMap.get(pointer);
        if (!table) {
          const keys = this.readTableKeys(thread, index);
          const isSequential = keys.length > 0 && keys.every((key, index2) => key === String(index2 + 1));
          table = isSequential ? [] : {};
          seenMap.set(pointer, table);
          this.readTableValues(thread, index, seenMap, table);
        }
        return table;
      }
      pushValue(thread, { target }, userdata) {
        if (typeof target !== "object" || target === null) {
          return false;
        }
        const seenMap = userdata || new Map;
        const existingReference = seenMap.get(target);
        if (existingReference !== undefined) {
          thread.lua.lua_rawgeti(thread.address, LUA_REGISTRYINDEX, BigInt(existingReference));
          return true;
        }
        try {
          const tableIndex = thread.getTop() + 1;
          const createTable = (arrayCount, keyCount) => {
            thread.lua.lua_createtable(thread.address, arrayCount, keyCount);
            const ref = thread.lua.luaL_ref(thread.address, LUA_REGISTRYINDEX);
            seenMap.set(target, ref);
            thread.lua.lua_rawgeti(thread.address, LUA_REGISTRYINDEX, BigInt(ref));
          };
          if (Array.isArray(target)) {
            createTable(target.length, 0);
            for (let i = 0;i < target.length; i++) {
              thread.pushValue(i + 1, seenMap);
              thread.pushValue(target[i], seenMap);
              thread.lua.lua_settable(thread.address, tableIndex);
            }
          } else {
            createTable(0, Object.getOwnPropertyNames(target).length);
            for (const key in target) {
              thread.pushValue(key, seenMap);
              thread.pushValue(target[key], seenMap);
              thread.lua.lua_settable(thread.address, tableIndex);
            }
          }
        } finally {
          if (userdata === undefined) {
            for (const reference of seenMap.values()) {
              thread.lua.luaL_unref(thread.address, LUA_REGISTRYINDEX, reference);
            }
          }
        }
        return true;
      }
      readTableKeys(thread, index) {
        const keys = [];
        thread.lua.lua_pushnil(thread.address);
        while (thread.lua.lua_next(thread.address, index)) {
          const key = thread.indexToString(-2);
          keys.push(key);
          thread.pop();
        }
        return keys;
      }
      readTableValues(thread, index, seenMap, table) {
        const isArray = Array.isArray(table);
        thread.lua.lua_pushnil(thread.address);
        while (thread.lua.lua_next(thread.address, index)) {
          const key = thread.indexToString(-2);
          const value = thread.getValue(-1, undefined, seenMap);
          if (isArray) {
            table.push(value);
          } else {
            table[key] = value;
          }
          thread.pop();
        }
      }
    }
    function createTypeExtension$1(thread) {
      return new TableTypeExtension(thread);
    }
    function decorateUserdata(target) {
      return new Decoration(target, { reference: true });
    }

    class UserdataTypeExtension extends LuaTypeExtension {
      constructor(thread) {
        super(thread, "js_userdata");
        this.gcPointer = thread.lua.module.addFunction((functionStateAddress) => {
          const userDataPointer = thread.lua.luaL_checkudata(functionStateAddress, 1, this.name);
          const referencePointer = thread.lua.module.getValue(userDataPointer, "*");
          thread.lua.unref(referencePointer);
          return exports2.LuaReturn.Ok;
        }, "ii");
        if (thread.lua.luaL_newmetatable(thread.address, this.name)) {
          const metatableIndex = thread.lua.lua_gettop(thread.address);
          thread.lua.lua_pushstring(thread.address, "protected metatable");
          thread.lua.lua_setfield(thread.address, metatableIndex, "__metatable");
          thread.lua.lua_pushcclosure(thread.address, this.gcPointer, 0);
          thread.lua.lua_setfield(thread.address, metatableIndex, "__gc");
        }
        thread.lua.lua_pop(thread.address, 1);
      }
      isType(_thread, _index, type, name) {
        return type === exports2.LuaType.Userdata && name === this.name;
      }
      getValue(thread, index) {
        const refUserdata = thread.lua.lua_touserdata(thread.address, index);
        const referencePointer = thread.lua.module.getValue(refUserdata, "*");
        return thread.lua.getRef(referencePointer);
      }
      pushValue(thread, decoratedValue) {
        if (!decoratedValue.options.reference) {
          return false;
        }
        return super.pushValue(thread, decoratedValue);
      }
      close() {
        this.thread.lua.module.removeFunction(this.gcPointer);
      }
    }
    function createTypeExtension(thread) {
      return new UserdataTypeExtension(thread);
    }

    class LuaEngine {
      constructor(cmodule, { openStandardLibs = true, injectObjects = false, enableProxy = true, traceAllocations = false, functionTimeout = undefined } = {}) {
        this.cmodule = cmodule;
        this.global = new Global(this.cmodule, traceAllocations);
        this.global.registerTypeExtension(0, createTypeExtension$1(this.global));
        this.global.registerTypeExtension(0, createTypeExtension$5(this.global, { functionTimeout }));
        this.global.registerTypeExtension(1, createTypeExtension$3(this.global, injectObjects));
        if (injectObjects) {
          this.global.registerTypeExtension(5, createTypeExtension$4(this.global));
        }
        if (enableProxy) {
          this.global.registerTypeExtension(3, createTypeExtension$2(this.global));
        } else {
          this.global.registerTypeExtension(1, createTypeExtension$6(this.global, injectObjects));
        }
        this.global.registerTypeExtension(4, createTypeExtension(this.global));
        if (openStandardLibs) {
          this.cmodule.luaL_openlibs(this.global.address);
        }
      }
      doString(script) {
        return this.callByteCode((thread) => thread.loadString(script));
      }
      doFile(filename) {
        return this.callByteCode((thread) => thread.loadFile(filename));
      }
      doStringSync(script) {
        this.global.loadString(script);
        const result = this.global.runSync();
        return result[0];
      }
      doFileSync(filename) {
        this.global.loadFile(filename);
        const result = this.global.runSync();
        return result[0];
      }
      async callByteCode(loader) {
        const thread = this.global.newThread();
        const threadIndex = this.global.getTop();
        try {
          loader(thread);
          const result = await thread.run(0);
          if (result.length > 0) {
            this.cmodule.lua_xmove(thread.address, this.global.address, result.length);
            return this.global.getValue(this.global.getTop() - result.length + 1);
          }
          return;
        } finally {
          this.global.remove(threadIndex);
        }
      }
    }
    var initWasmModule = (() => {
      var _scriptDir = typeof document === "undefined" && typeof location === "undefined" ? (init_url(), __toCommonJS(exports_url)).pathToFileURL(__filename).href : typeof document === "undefined" ? location.href : _documentCurrentScript && _documentCurrentScript.src || new URL("index.js", document.baseURI).href;
      return async function(moduleArg = {}) {
        var e = moduleArg, aa, ba;
        e.ready = new Promise((a, b) => {
          aa = a;
          ba = b;
        });
        "_malloc _free _realloc _luaL_checkversion_ _luaL_getmetafield _luaL_callmeta _luaL_tolstring _luaL_argerror _luaL_typeerror _luaL_checklstring _luaL_optlstring _luaL_checknumber _luaL_optnumber _luaL_checkinteger _luaL_optinteger _luaL_checkstack _luaL_checktype _luaL_checkany _luaL_newmetatable _luaL_setmetatable _luaL_testudata _luaL_checkudata _luaL_where _luaL_fileresult _luaL_execresult _luaL_ref _luaL_unref _luaL_loadfilex _luaL_loadbufferx _luaL_loadstring _luaL_newstate _luaL_len _luaL_addgsub _luaL_gsub _luaL_setfuncs _luaL_getsubtable _luaL_traceback _luaL_requiref _luaL_buffinit _luaL_prepbuffsize _luaL_addlstring _luaL_addstring _luaL_addvalue _luaL_pushresult _luaL_pushresultsize _luaL_buffinitsize _lua_newstate _lua_close _lua_newthread _lua_resetthread _lua_atpanic _lua_version _lua_absindex _lua_gettop _lua_settop _lua_pushvalue _lua_rotate _lua_copy _lua_checkstack _lua_xmove _lua_isnumber _lua_isstring _lua_iscfunction _lua_isinteger _lua_isuserdata _lua_type _lua_typename _lua_tonumberx _lua_tointegerx _lua_toboolean _lua_tolstring _lua_rawlen _lua_tocfunction _lua_touserdata _lua_tothread _lua_topointer _lua_arith _lua_rawequal _lua_compare _lua_pushnil _lua_pushnumber _lua_pushinteger _lua_pushlstring _lua_pushstring _lua_pushcclosure _lua_pushboolean _lua_pushlightuserdata _lua_pushthread _lua_getglobal _lua_gettable _lua_getfield _lua_geti _lua_rawget _lua_rawgeti _lua_rawgetp _lua_createtable _lua_newuserdatauv _lua_getmetatable _lua_getiuservalue _lua_setglobal _lua_settable _lua_setfield _lua_seti _lua_rawset _lua_rawseti _lua_rawsetp _lua_setmetatable _lua_setiuservalue _lua_callk _lua_pcallk _lua_load _lua_dump _lua_yieldk _lua_resume _lua_status _lua_isyieldable _lua_setwarnf _lua_warning _lua_error _lua_next _lua_concat _lua_len _lua_stringtonumber _lua_getallocf _lua_setallocf _lua_toclose _lua_closeslot _lua_getstack _lua_getinfo _lua_getlocal _lua_setlocal _lua_getupvalue _lua_setupvalue _lua_upvalueid _lua_upvaluejoin _lua_sethook _lua_gethook _lua_gethookmask _lua_gethookcount _lua_setcstacklimit _luaopen_base _luaopen_coroutine _luaopen_table _luaopen_io _luaopen_os _luaopen_string _luaopen_utf8 _luaopen_math _luaopen_debug _luaopen_package _luaL_openlibs _memory ___indirect_function_table _fflush onRuntimeInitialized".split(" ").forEach((a) => {
          Object.getOwnPropertyDescriptor(e.ready, a) || Object.defineProperty(e.ready, a, { get: () => g("You are getting " + a + " on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js"), set: () => g("You are setting " + a + " on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js") });
        });
        var ca = Object.assign({}, e), da = "./this.program", ea = (a, b) => {
          throw b;
        }, fa = typeof window == "object", k = typeof importScripts == "function", n = typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string", ha = !fa && !n && !k;
        if (e.ENVIRONMENT)
          throw Error("Module.ENVIRONMENT has been deprecated. To force the environment, use the ENVIRONMENT compile-time option (for example, -sENVIRONMENT=web or -sENVIRONMENT=node)");
        var r = "", ia, ja, ka;
        if (n) {
          if (typeof process == "undefined" || !process.release || process.release.name !== "node")
            throw Error("not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)");
          var la = process.versions.node, ma = la.split(".").slice(0, 3);
          ma = 1e4 * ma[0] + 100 * ma[1] + 1 * ma[2].split("-")[0];
          if (160000 > ma)
            throw Error("This emscripten-generated code requires node v16.0.0 (detected v" + la + ")");
          const { createRequire: a } = await import("module");
          var require$1 = a(typeof document === "undefined" && typeof location === "undefined" ? (init_url(), __toCommonJS(exports_url)).pathToFileURL(__filename).href : typeof document === "undefined" ? location.href : _documentCurrentScript && _documentCurrentScript.src || new URL("index.js", document.baseURI).href), fs = require$1("fs"), na = require$1("path");
          k ? r = na.dirname(r) + "/" : r = require$1("url").fileURLToPath(new URL("./", typeof document === "undefined" && typeof location === "undefined" ? (init_url(), __toCommonJS(exports_url)).pathToFileURL(__filename).href : typeof document === "undefined" ? location.href : _documentCurrentScript && _documentCurrentScript.src || new URL("index.js", document.baseURI).href));
          ia = (b, c) => {
            b = oa(b) ? new URL(b) : na.normalize(b);
            return fs.readFileSync(b, c ? undefined : "utf8");
          };
          ka = (b) => {
            b = ia(b, true);
            b.buffer || (b = new Uint8Array(b));
            u(b.buffer);
            return b;
          };
          ja = (b, c, d, f = true) => {
            b = oa(b) ? new URL(b) : na.normalize(b);
            fs.readFile(b, f ? undefined : "utf8", (h, m) => {
              h ? d(h) : c(f ? m.buffer : m);
            });
          };
          !e.thisProgram && 1 < process.argv.length && (da = process.argv[1].replace(/\\/g, "/"));
          process.argv.slice(2);
          ea = (b, c) => {
            process.exitCode = b;
            throw c;
          };
          e.inspect = () => "[Emscripten Module object]";
        } else if (ha) {
          if (typeof process == "object" && typeof require$1 === "function" || typeof window == "object" || typeof importScripts == "function")
            throw Error("not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)");
          typeof read != "undefined" && (ia = read);
          ka = (a) => {
            if (typeof readbuffer == "function")
              return new Uint8Array(readbuffer(a));
            a = read(a, "binary");
            u(typeof a == "object");
            return a;
          };
          ja = (a, b) => {
            setTimeout(() => b(ka(a)));
          };
          typeof clearTimeout == "undefined" && (globalThis.clearTimeout = () => {});
          typeof setTimeout == "undefined" && (globalThis.setTimeout = (a) => typeof a == "function" ? a() : g());
          typeof quit == "function" && (ea = (a, b) => {
            setTimeout(() => {
              if (!(b instanceof pa)) {
                let c = b;
                b && typeof b == "object" && b.stack && (c = [b, b.stack]);
                z(`exiting due to exception: ${c}`);
              }
              quit(a);
            });
            throw b;
          });
          typeof print != "undefined" && (typeof console == "undefined" && (console = {}), console.log = print, console.warn = console.error = typeof printErr != "undefined" ? printErr : print);
        } else if (fa || k) {
          k ? r = self.location.href : typeof document != "undefined" && document.currentScript && (r = document.currentScript.src);
          _scriptDir && (r = _scriptDir);
          r.indexOf("blob:") !== 0 ? r = r.substr(0, r.replace(/[?#].*/, "").lastIndexOf("/") + 1) : r = "";
          if (typeof window != "object" && typeof importScripts != "function")
            throw Error("not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)");
          ia = (a) => {
            var b = new XMLHttpRequest;
            b.open("GET", a, false);
            b.send(null);
            return b.responseText;
          };
          k && (ka = (a) => {
            var b = new XMLHttpRequest;
            b.open("GET", a, false);
            b.responseType = "arraybuffer";
            b.send(null);
            return new Uint8Array(b.response);
          });
          ja = (a, b, c) => {
            var d = new XMLHttpRequest;
            d.open("GET", a, true);
            d.responseType = "arraybuffer";
            d.onload = () => {
              d.status == 200 || d.status == 0 && d.response ? b(d.response) : c();
            };
            d.onerror = c;
            d.send(null);
          };
        } else
          throw Error("environment detection error");
        var qa = console.log.bind(console), z = console.error.bind(console);
        Object.assign(e, ca);
        ca = null;
        C("ENVIRONMENT");
        C("GL_MAX_TEXTURE_IMAGE_UNITS");
        C("SDL_canPlayWithWebAudio");
        C("SDL_numSimultaneouslyQueuedBuffers");
        C("INITIAL_MEMORY");
        C("wasmMemory");
        C("arguments");
        C("buffer");
        C("canvas");
        C("doNotCaptureKeyboard");
        C("dynamicLibraries");
        C("elementPointerLock");
        C("extraStackTrace");
        C("forcedAspectRatio");
        C("instantiateWasm");
        C("keyboardListeningElement");
        C("freePreloadedMediaOnUse");
        C("loadSplitModule");
        C("logReadFiles");
        C("mainScriptUrlOrBlob");
        C("mem");
        C("monitorRunDependencies");
        C("noExitRuntime");
        C("noInitialRun");
        C("onAbort");
        C("onCustomMessage");
        C("onExit");
        C("onFree");
        C("onFullScreen");
        C("onMalloc");
        C("onRealloc");
        C("onRuntimeInitialized");
        C("postMainLoop");
        C("postRun");
        C("preInit");
        C("preMainLoop");
        C("preinitializedWebGLContext");
        C("memoryInitializerRequest");
        C("preloadPlugins");
        C("print");
        C("printErr");
        C("quit");
        C("setStatus");
        C("statusMessage");
        C("stderr");
        C("stdin");
        C("stdout");
        C("thisProgram");
        C("wasm");
        C("wasmBinary");
        C("websocket");
        C("fetchSettings");
        D("arguments", "arguments_");
        D("thisProgram", "thisProgram");
        D("quit", "quit_");
        u(typeof e.memoryInitializerPrefixURL == "undefined", "Module.memoryInitializerPrefixURL option was removed, use Module.locateFile instead");
        u(typeof e.pthreadMainPrefixURL == "undefined", "Module.pthreadMainPrefixURL option was removed, use Module.locateFile instead");
        u(typeof e.cdInitializerPrefixURL == "undefined", "Module.cdInitializerPrefixURL option was removed, use Module.locateFile instead");
        u(typeof e.filePackagePrefixURL == "undefined", "Module.filePackagePrefixURL option was removed, use Module.locateFile instead");
        u(typeof e.read == "undefined", "Module.read option was removed (modify read_ in JS)");
        u(typeof e.readAsync == "undefined", "Module.readAsync option was removed (modify readAsync in JS)");
        u(typeof e.readBinary == "undefined", "Module.readBinary option was removed (modify readBinary in JS)");
        u(typeof e.setWindowTitle == "undefined", "Module.setWindowTitle option was removed (modify emscripten_set_window_title in JS)");
        u(typeof e.TOTAL_MEMORY == "undefined", "Module.TOTAL_MEMORY has been renamed Module.INITIAL_MEMORY");
        D("asm", "wasmExports");
        D("read", "read_");
        D("readAsync", "readAsync");
        D("readBinary", "readBinary");
        D("setWindowTitle", "setWindowTitle");
        u(!ha, "shell environment detected but not enabled at build time.  Add 'shell' to `-sENVIRONMENT` to enable.");
        D("wasmBinary", "wasmBinary");
        typeof WebAssembly != "object" && g("no native wasm support detected");
        var ra, sa = false;
        function u(a, b) {
          a || g("Assertion failed" + (b ? ": " + b : ""));
        }
        var E, ta, ua, F, G, va, wa, xa;
        function ya() {
          var a = ra.buffer;
          e.HEAP8 = E = new Int8Array(a);
          e.HEAP16 = ua = new Int16Array(a);
          e.HEAPU8 = ta = new Uint8Array(a);
          e.HEAPU16 = new Uint16Array(a);
          e.HEAP32 = F = new Int32Array(a);
          e.HEAPU32 = G = new Uint32Array(a);
          e.HEAPF32 = va = new Float32Array(a);
          e.HEAPF64 = xa = new Float64Array(a);
          e.HEAP64 = wa = new BigInt64Array(a);
          e.HEAPU64 = new BigUint64Array(a);
        }
        u(!e.STACK_SIZE, "STACK_SIZE can no longer be set at runtime.  Use -sSTACK_SIZE at link time");
        u(typeof Int32Array != "undefined" && typeof Float64Array !== "undefined" && Int32Array.prototype.subarray != null && Int32Array.prototype.set != null, "JS engine does not provide full typed array support");
        u(!e.wasmMemory, "Use of `wasmMemory` detected.  Use -sIMPORTED_MEMORY to define wasmMemory externally");
        u(!e.INITIAL_MEMORY, "Detected runtime INITIAL_MEMORY setting.  Use -sIMPORTED_MEMORY to define wasmMemory dynamically");
        function za() {
          if (!sa) {
            var a = Aa();
            a == 0 && (a += 4);
            var b = G[a >> 2], c = G[a + 4 >> 2];
            b == 34821223 && c == 2310721022 || g(`Stack overflow! Stack cookie has been overwritten at ${Ba(a)}, expected hex dwords 0x89BACDFE and 0x2135467, but received ${Ba(c)} ${Ba(b)}`);
            G[0] != 1668509029 && g("Runtime error: The application has corrupted its heap memory area (address zero)!");
          }
        }
        var Ca = new Int16Array(1), Da = new Int8Array(Ca.buffer);
        Ca[0] = 25459;
        if (Da[0] !== 115 || Da[1] !== 99)
          throw "Runtime error: expected the system to be little-endian! (Run with -sSUPPORT_BIG_ENDIAN to bypass)";
        var Ea = [], Fa = [], Ga = [], Ha = false;
        u(Math.imul, "This browser does not support Math.imul(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill");
        u(Math.fround, "This browser does not support Math.fround(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill");
        u(Math.clz32, "This browser does not support Math.clz32(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill");
        u(Math.trunc, "This browser does not support Math.trunc(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill");
        var Ia = 0, I = null, Ja = null, Ka = {};
        function La(a) {
          for (var b = a;; ) {
            if (!Ka[a])
              return a;
            a = b + Math.random();
          }
        }
        function Ma(a) {
          Ia++;
          a ? (u(!Ka[a]), Ka[a] = 1, I === null && typeof setInterval != "undefined" && (I = setInterval(() => {
            if (sa)
              clearInterval(I), I = null;
            else {
              var b = false, c;
              for (c in Ka)
                b || (b = true, z("still waiting on run dependencies:")), z(`dependency: ${c}`);
              b && z("(end of list)");
            }
          }, 1e4))) : z("warning: run dependency added without ID");
        }
        function Na(a) {
          Ia--;
          a ? (u(Ka[a]), delete Ka[a]) : z("warning: run dependency removed without ID");
          Ia == 0 && (I !== null && (clearInterval(I), I = null), Ja && (a = Ja, Ja = null, a()));
        }
        function g(a) {
          a = "Aborted(" + a + ")";
          z(a);
          sa = true;
          a = new WebAssembly.RuntimeError(a);
          ba(a);
          throw a;
        }
        var Oa = (a) => a.startsWith("data:application/octet-stream;base64,"), oa = (a) => a.startsWith("file://");
        function J(a) {
          return function() {
            u(Ha, `native function \`${a}\` called before runtime initialization`);
            var b = L[a];
            u(b, `exported native function \`${a}\` not found`);
            return b.apply(null, arguments);
          };
        }
        var M;
        if (e.locateFile) {
          if (M = "glue.wasm", !Oa(M)) {
            var Pa = M;
            M = e.locateFile ? e.locateFile(Pa, r) : r + Pa;
          }
        } else
          M = new URL("glue.wasm", typeof document === "undefined" && typeof location === "undefined" ? (init_url(), __toCommonJS(exports_url)).pathToFileURL(__filename).href : typeof document === "undefined" ? location.href : _documentCurrentScript && _documentCurrentScript.src || new URL("index.js", document.baseURI).href).href;
        function Qa(a) {
          if (ka)
            return ka(a);
          throw "both async and sync fetching of the wasm failed";
        }
        function Ra(a) {
          if (fa || k) {
            if (typeof fetch == "function" && !oa(a))
              return fetch(a, { credentials: "same-origin" }).then((b) => {
                if (!b.ok)
                  throw "failed to load wasm binary file at '" + a + "'";
                return b.arrayBuffer();
              }).catch(() => Qa(a));
            if (ja)
              return new Promise((b, c) => {
                ja(a, (d) => b(new Uint8Array(d)), c);
              });
          }
          return Promise.resolve().then(() => Qa(a));
        }
        function Sa(a, b, c) {
          return Ra(a).then((d) => WebAssembly.instantiate(d, b)).then((d) => d).then(c, (d) => {
            z(`failed to asynchronously prepare wasm: ${d}`);
            oa(M) && z(`warning: Loading from a file URI (${M}) is not supported in most browsers. See https://emscripten.org/docs/getting_started/FAQ.html#how-do-i-run-a-local-webserver-for-testing-why-does-my-program-stall-in-downloading-or-preparing`);
            g(d);
          });
        }
        function Ta(a, b) {
          var c = M;
          return typeof WebAssembly.instantiateStreaming != "function" || Oa(c) || oa(c) || n || typeof fetch != "function" ? Sa(c, a, b) : fetch(c, { credentials: "same-origin" }).then((d) => WebAssembly.instantiateStreaming(d, a).then(b, function(f) {
            z(`wasm streaming compile failed: ${f}`);
            z("falling back to ArrayBuffer instantiation");
            return Sa(c, a, b);
          }));
        }
        function D(a, b) {
          Object.getOwnPropertyDescriptor(e, a) || Object.defineProperty(e, a, { configurable: true, get() {
            g(`\`Module.${a}\` has been replaced by \`${b}\` (the initial value can be provided on Module, but after startup the value is only looked for on a local variable of that name)`);
          } });
        }
        function C(a) {
          Object.getOwnPropertyDescriptor(e, a) && g(`\`Module.${a}\` was supplied but \`${a}\` not included in INCOMING_MODULE_JS_API`);
        }
        function Ua(a) {
          return a === "FS_createPath" || a === "FS_createDataFile" || a === "FS_createPreloadedFile" || a === "FS_unlink" || a === "addRunDependency" || a === "FS_createLazyFile" || a === "FS_createDevice" || a === "removeRunDependency";
        }
        function Va(a, b) {
          typeof globalThis !== "undefined" && Object.defineProperty(globalThis, a, { configurable: true, get() {
            Wa(`\`${a}\` is not longer defined by emscripten. ${b}`);
          } });
        }
        Va("buffer", "Please use HEAP8.buffer or wasmMemory.buffer");
        Va("asm", "Please use wasmExports instead");
        function Xa(a) {
          Object.getOwnPropertyDescriptor(e, a) || Object.defineProperty(e, a, { configurable: true, get() {
            var b = `'${a}' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the Emscripten FAQ)`;
            Ua(a) && (b += ". Alternatively, forcing filesystem support (-sFORCE_FILESYSTEM) can export this for you");
            g(b);
          } });
        }
        function pa(a) {
          this.name = "ExitStatus";
          this.message = `Program terminated with exit(${a})`;
          this.status = a;
        }
        var Ba = (a) => {
          u(typeof a === "number");
          return "0x" + (a >>> 0).toString(16).padStart(8, "0");
        }, Wa = (a) => {
          Ya ||= {};
          Ya[a] || (Ya[a] = 1, n && (a = "warning: " + a), z(a));
        }, Ya, Za = (a, b) => {
          for (var c = 0, d = a.length - 1;0 <= d; d--) {
            var f = a[d];
            f === "." ? a.splice(d, 1) : f === ".." ? (a.splice(d, 1), c++) : c && (a.splice(d, 1), c--);
          }
          if (b)
            for (;c; c--)
              a.unshift("..");
          return a;
        }, P = (a) => {
          var b = a.charAt(0) === "/", c = a.substr(-1) === "/";
          (a = Za(a.split("/").filter((d) => !!d), !b).join("/")) || b || (a = ".");
          a && c && (a += "/");
          return (b ? "/" : "") + a;
        }, $a = (a) => {
          var b = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/.exec(a).slice(1);
          a = b[0];
          b = b[1];
          if (!a && !b)
            return ".";
          b &&= b.substr(0, b.length - 1);
          return a + b;
        }, Q = (a) => {
          if (a === "/")
            return "/";
          a = P(a);
          a = a.replace(/\/$/, "");
          var b = a.lastIndexOf("/");
          return b === -1 ? a : a.substr(b + 1);
        }, ab = (a, b) => P(a + "/" + b), bb = () => {
          if (typeof crypto == "object" && typeof crypto.getRandomValues == "function")
            return (c) => crypto.getRandomValues(c);
          if (n)
            try {
              var a = require$1("crypto");
              if (a.randomFillSync)
                return (c) => a.randomFillSync(c);
              var b = a.randomBytes;
              return (c) => (c.set(b(c.byteLength)), c);
            } catch (c) {}
          g("no cryptographic support found for randomDevice. consider polyfilling it if you want to use something insecure like Math.random(), e.g. put this in a --pre-js: var crypto = { getRandomValues: (array) => { for (var i = 0; i < array.length; i++) array[i] = (Math.random()*256)|0 } };");
        }, cb = (a) => (cb = bb())(a);
        function db() {
          for (var a = "", b = false, c = arguments.length - 1;-1 <= c && !b; c--) {
            b = 0 <= c ? arguments[c] : R.cwd();
            if (typeof b != "string")
              throw new TypeError("Arguments to path.resolve must be strings");
            if (!b)
              return "";
            a = b + "/" + a;
            b = b.charAt(0) === "/";
          }
          a = Za(a.split("/").filter((d) => !!d), !b).join("/");
          return (b ? "/" : "") + a || ".";
        }
        var eb = (a, b) => {
          function c(m) {
            for (var p = 0;p < m.length && m[p] === ""; p++)
              ;
            for (var y = m.length - 1;0 <= y && m[y] === ""; y--)
              ;
            return p > y ? [] : m.slice(p, y - p + 1);
          }
          a = db(a).substr(1);
          b = db(b).substr(1);
          a = c(a.split("/"));
          b = c(b.split("/"));
          for (var d = Math.min(a.length, b.length), f = d, h = 0;h < d; h++)
            if (a[h] !== b[h]) {
              f = h;
              break;
            }
          d = [];
          for (h = f;h < a.length; h++)
            d.push("..");
          d = d.concat(b.slice(f));
          return d.join("/");
        }, gb = typeof TextDecoder != "undefined" ? new TextDecoder("utf8") : undefined, hb = (a, b) => {
          for (var c = b + NaN, d = b;a[d] && !(d >= c); )
            ++d;
          if (16 < d - b && a.buffer && gb)
            return gb.decode(a.subarray(b, d));
          for (c = "";b < d; ) {
            var f = a[b++];
            if (f & 128) {
              var h = a[b++] & 63;
              if ((f & 224) == 192)
                c += String.fromCharCode((f & 31) << 6 | h);
              else {
                var m = a[b++] & 63;
                (f & 240) == 224 ? f = (f & 15) << 12 | h << 6 | m : ((f & 248) != 240 && Wa("Invalid UTF-8 leading byte " + Ba(f) + " encountered when deserializing a UTF-8 string in wasm memory to a JS string!"), f = (f & 7) << 18 | h << 12 | m << 6 | a[b++] & 63);
                65536 > f ? c += String.fromCharCode(f) : (f -= 65536, c += String.fromCharCode(55296 | f >> 10, 56320 | f & 1023));
              }
            } else
              c += String.fromCharCode(f);
          }
          return c;
        }, ib = [], jb = (a) => {
          for (var b = 0, c = 0;c < a.length; ++c) {
            var d = a.charCodeAt(c);
            127 >= d ? b++ : 2047 >= d ? b += 2 : 55296 <= d && 57343 >= d ? (b += 4, ++c) : b += 3;
          }
          return b;
        }, kb = (a, b, c, d) => {
          u(typeof a === "string", `stringToUTF8Array expects a string (got ${typeof a})`);
          if (!(0 < d))
            return 0;
          var f = c;
          d = c + d - 1;
          for (var h = 0;h < a.length; ++h) {
            var m = a.charCodeAt(h);
            if (55296 <= m && 57343 >= m) {
              var p = a.charCodeAt(++h);
              m = 65536 + ((m & 1023) << 10) | p & 1023;
            }
            if (127 >= m) {
              if (c >= d)
                break;
              b[c++] = m;
            } else {
              if (2047 >= m) {
                if (c + 1 >= d)
                  break;
                b[c++] = 192 | m >> 6;
              } else {
                if (65535 >= m) {
                  if (c + 2 >= d)
                    break;
                  b[c++] = 224 | m >> 12;
                } else {
                  if (c + 3 >= d)
                    break;
                  1114111 < m && Wa("Invalid Unicode code point " + Ba(m) + " encountered when serializing a JS string to a UTF-8 string in wasm memory! (Valid unicode code points should be in range 0-0x10FFFF).");
                  b[c++] = 240 | m >> 18;
                  b[c++] = 128 | m >> 12 & 63;
                }
                b[c++] = 128 | m >> 6 & 63;
              }
              b[c++] = 128 | m & 63;
            }
          }
          b[c] = 0;
          return c - f;
        };
        function lb(a, b) {
          var c = Array(jb(a) + 1);
          a = kb(a, c, 0, c.length);
          b && (c.length = a);
          return c;
        }
        var mb = [];
        function nb(a, b) {
          mb[a] = { input: [], output: [], K: b };
          ob(a, pb);
        }
        var pb = { open(a) {
          var b = mb[a.node.rdev];
          if (!b)
            throw new R.g(43);
          a.tty = b;
          a.seekable = false;
        }, close(a) {
          a.tty.K.fsync(a.tty);
        }, fsync(a) {
          a.tty.K.fsync(a.tty);
        }, read(a, b, c, d) {
          if (!a.tty || !a.tty.K.ra)
            throw new R.g(60);
          for (var f = 0, h = 0;h < d; h++) {
            try {
              var m = a.tty.K.ra(a.tty);
            } catch (p) {
              throw new R.g(29);
            }
            if (m === undefined && f === 0)
              throw new R.g(6);
            if (m === null || m === undefined)
              break;
            f++;
            b[c + h] = m;
          }
          f && (a.node.timestamp = Date.now());
          return f;
        }, write(a, b, c, d) {
          if (!a.tty || !a.tty.K.ia)
            throw new R.g(60);
          try {
            for (var f = 0;f < d; f++)
              a.tty.K.ia(a.tty, b[c + f]);
          } catch (h) {
            throw new R.g(29);
          }
          d && (a.node.timestamp = Date.now());
          return f;
        } }, qb = { ra() {
          a: {
            if (!ib.length) {
              var a = null;
              if (n) {
                var b = Buffer.alloc(256), c = 0, d = process.stdin.fd;
                try {
                  c = fs.readSync(d, b);
                } catch (f) {
                  if (f.toString().includes("EOF"))
                    c = 0;
                  else
                    throw f;
                }
                0 < c ? a = b.slice(0, c).toString("utf-8") : a = null;
              } else
                typeof window != "undefined" && typeof window.prompt == "function" ? (a = window.prompt("Input: "), a !== null && (a += `
`)) : typeof readline == "function" && (a = readline(), a !== null && (a += `
`));
              if (!a) {
                a = null;
                break a;
              }
              ib = lb(a, true);
            }
            a = ib.shift();
          }
          return a;
        }, ia(a, b) {
          b === null || b === 10 ? (qa(hb(a.output, 0)), a.output = []) : b != 0 && a.output.push(b);
        }, fsync(a) {
          a.output && 0 < a.output.length && (qa(hb(a.output, 0)), a.output = []);
        }, Ia() {
          return { ab: 25856, cb: 5, $a: 191, bb: 35387, Za: [3, 28, 127, 21, 4, 0, 1, 0, 17, 19, 26, 0, 18, 15, 23, 22, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
        }, Ja() {
          return 0;
        }, Ka() {
          return [24, 80];
        } }, rb = { ia(a, b) {
          b === null || b === 10 ? (z(hb(a.output, 0)), a.output = []) : b != 0 && a.output.push(b);
        }, fsync(a) {
          a.output && 0 < a.output.length && (z(hb(a.output, 0)), a.output = []);
        } }, sb = () => {
          g("internal error: mmapAlloc called but `emscripten_builtin_memalign` native symbol not exported");
        };
        function tb(a, b) {
          var c = a.m ? a.m.length : 0;
          c >= b || (b = Math.max(b, c * (1048576 > c ? 2 : 1.125) >>> 0), c != 0 && (b = Math.max(b, 256)), c = a.m, a.m = new Uint8Array(b), 0 < a.o && a.m.set(c.subarray(0, a.o), 0));
        }
        var S = { G: null, s() {
          return S.createNode(null, "/", 16895, 0);
        }, createNode(a, b, c, d) {
          if ((c & 61440) === 24576 || R.isFIFO(c))
            throw new R.g(63);
          S.G || (S.G = { dir: { node: { C: S.h.C, v: S.h.v, lookup: S.h.lookup, J: S.h.J, rename: S.h.rename, unlink: S.h.unlink, rmdir: S.h.rmdir, readdir: S.h.readdir, symlink: S.h.symlink }, stream: { D: S.l.D } }, file: { node: { C: S.h.C, v: S.h.v }, stream: { D: S.l.D, read: S.l.read, write: S.l.write, T: S.l.T, S: S.l.S, V: S.l.V } }, link: { node: { C: S.h.C, v: S.h.v, readlink: S.h.readlink }, stream: {} }, na: { node: { C: S.h.C, v: S.h.v }, stream: R.Da } });
          c = R.createNode(a, b, c, d);
          T(c.mode) ? (c.h = S.G.dir.node, c.l = S.G.dir.stream, c.m = {}) : R.isFile(c.mode) ? (c.h = S.G.file.node, c.l = S.G.file.stream, c.o = 0, c.m = null) : (c.mode & 61440) === 40960 ? (c.h = S.G.link.node, c.l = S.G.link.stream) : (c.mode & 61440) === 8192 && (c.h = S.G.na.node, c.l = S.G.na.stream);
          c.timestamp = Date.now();
          a && (a.m[b] = c, a.timestamp = c.timestamp);
          return c;
        }, lb(a) {
          return a.m ? a.m.subarray ? a.m.subarray(0, a.o) : new Uint8Array(a.m) : new Uint8Array(0);
        }, h: { C(a) {
          var b = {};
          b.dev = (a.mode & 61440) === 8192 ? a.id : 1;
          b.ino = a.id;
          b.mode = a.mode;
          b.nlink = 1;
          b.uid = 0;
          b.gid = 0;
          b.rdev = a.rdev;
          T(a.mode) ? b.size = 4096 : R.isFile(a.mode) ? b.size = a.o : (a.mode & 61440) === 40960 ? b.size = a.link.length : b.size = 0;
          b.atime = new Date(a.timestamp);
          b.mtime = new Date(a.timestamp);
          b.ctime = new Date(a.timestamp);
          b.Ba = 4096;
          b.blocks = Math.ceil(b.size / b.Ba);
          return b;
        }, v(a, b) {
          b.mode !== undefined && (a.mode = b.mode);
          b.timestamp !== undefined && (a.timestamp = b.timestamp);
          if (b.size !== undefined && (b = b.size, a.o != b))
            if (b == 0)
              a.m = null, a.o = 0;
            else {
              var c = a.m;
              a.m = new Uint8Array(b);
              c && a.m.set(c.subarray(0, Math.min(b, a.o)));
              a.o = b;
            }
        }, lookup() {
          throw R.da[44];
        }, J(a, b, c, d) {
          return S.createNode(a, b, c, d);
        }, rename(a, b, c) {
          if (T(a.mode)) {
            try {
              var d = U(b, c);
            } catch (h) {}
            if (d)
              for (var f in d.m)
                throw new R.g(55);
          }
          delete a.parent.m[a.name];
          a.parent.timestamp = Date.now();
          a.name = c;
          b.m[c] = a;
          b.timestamp = a.parent.timestamp;
          a.parent = b;
        }, unlink(a, b) {
          delete a.m[b];
          a.timestamp = Date.now();
        }, rmdir(a, b) {
          var c = U(a, b), d;
          for (d in c.m)
            throw new R.g(55);
          delete a.m[b];
          a.timestamp = Date.now();
        }, readdir(a) {
          var b = [".", ".."], c;
          for (c in a.m)
            a.m.hasOwnProperty(c) && b.push(c);
          return b;
        }, symlink(a, b, c) {
          a = S.createNode(a, b, 41471, 0);
          a.link = c;
          return a;
        }, readlink(a) {
          if ((a.mode & 61440) !== 40960)
            throw new R.g(28);
          return a.link;
        } }, l: { read(a, b, c, d, f) {
          var h = a.node.m;
          if (f >= a.node.o)
            return 0;
          a = Math.min(a.node.o - f, d);
          u(0 <= a);
          if (8 < a && h.subarray)
            b.set(h.subarray(f, f + a), c);
          else
            for (d = 0;d < a; d++)
              b[c + d] = h[f + d];
          return a;
        }, write(a, b, c, d, f, h) {
          u(!(b instanceof ArrayBuffer));
          b.buffer === E.buffer && (h = false);
          if (!d)
            return 0;
          a = a.node;
          a.timestamp = Date.now();
          if (b.subarray && (!a.m || a.m.subarray)) {
            if (h)
              return u(f === 0, "canOwn must imply no weird position inside the file"), a.m = b.subarray(c, c + d), a.o = d;
            if (a.o === 0 && f === 0)
              return a.m = b.slice(c, c + d), a.o = d;
            if (f + d <= a.o)
              return a.m.set(b.subarray(c, c + d), f), d;
          }
          tb(a, f + d);
          if (a.m.subarray && b.subarray)
            a.m.set(b.subarray(c, c + d), f);
          else
            for (h = 0;h < d; h++)
              a.m[f + h] = b[c + h];
          a.o = Math.max(a.o, f + d);
          return d;
        }, D(a, b, c) {
          c === 1 ? b += a.position : c === 2 && R.isFile(a.node.mode) && (b += a.node.o);
          if (0 > b)
            throw new R.g(28);
          return b;
        }, T(a, b, c) {
          tb(a.node, b + c);
          a.node.o = Math.max(a.node.o, b + c);
        }, S(a, b, c, d, f) {
          if (!R.isFile(a.node.mode))
            throw new R.g(43);
          a = a.node.m;
          if (f & 2 || a.buffer !== E.buffer) {
            if (0 < c || c + b < a.length)
              a.subarray ? a = a.subarray(c, c + b) : a = Array.prototype.slice.call(a, c, c + b);
            c = true;
            b = sb();
            if (!b)
              throw new R.g(48);
            E.set(a, b);
          } else
            c = false, b = a.byteOffset;
          return { Ra: b, Aa: c };
        }, V(a, b, c, d) {
          S.l.write(a, b, 0, d, c, false);
          return 0;
        } } }, ub = (a, b, c) => {
          var d = La(`al ${a}`);
          ja(a, (f) => {
            u(f, `Loading data file "${a}" failed (no arrayBuffer).`);
            b(new Uint8Array(f));
            d && Na(d);
          }, () => {
            if (c)
              c();
            else
              throw `Loading data file "${a}" failed.`;
          });
          d && Ma(d);
        }, vb = [], wb = (a, b, c, d) => {
          typeof Browser != "undefined" && Browser.R();
          var f = false;
          vb.forEach((h) => {
            !f && h.canHandle(b) && (h.handle(a, b, c, d), f = true);
          });
          return f;
        }, xb = (a, b) => {
          var c = 0;
          a && (c |= 365);
          b && (c |= 146);
          return c;
        }, yb = {
          0: "Success",
          1: "Arg list too long",
          2: "Permission denied",
          3: "Address already in use",
          4: "Address not available",
          5: "Address family not supported by protocol family",
          6: "No more processes",
          7: "Socket already connected",
          8: "Bad file number",
          9: "Trying to read unreadable message",
          10: "Mount device busy",
          11: "Operation canceled",
          12: "No children",
          13: "Connection aborted",
          14: "Connection refused",
          15: "Connection reset by peer",
          16: "File locking deadlock error",
          17: "Destination address required",
          18: "Math arg out of domain of func",
          19: "Quota exceeded",
          20: "File exists",
          21: "Bad address",
          22: "File too large",
          23: "Host is unreachable",
          24: "Identifier removed",
          25: "Illegal byte sequence",
          26: "Connection already in progress",
          27: "Interrupted system call",
          28: "Invalid argument",
          29: "I/O error",
          30: "Socket is already connected",
          31: "Is a directory",
          32: "Too many symbolic links",
          33: "Too many open files",
          34: "Too many links",
          35: "Message too long",
          36: "Multihop attempted",
          37: "File or path name too long",
          38: "Network interface is not configured",
          39: "Connection reset by network",
          40: "Network is unreachable",
          41: "Too many open files in system",
          42: "No buffer space available",
          43: "No such device",
          44: "No such file or directory",
          45: "Exec format error",
          46: "No record locks available",
          47: "The link has been severed",
          48: "Not enough core",
          49: "No message of desired type",
          50: "Protocol not available",
          51: "No space left on device",
          52: "Function not implemented",
          53: "Socket is not connected",
          54: "Not a directory",
          55: "Directory not empty",
          56: "State not recoverable",
          57: "Socket operation on non-socket",
          59: "Not a typewriter",
          60: "No such device or address",
          61: "Value too large for defined data type",
          62: "Previous owner died",
          63: "Not super-user",
          64: "Broken pipe",
          65: "Protocol error",
          66: "Unknown protocol",
          67: "Protocol wrong type for socket",
          68: "Math result not representable",
          69: "Read only file system",
          70: "Illegal seek",
          71: "No such process",
          72: "Stale file handle",
          73: "Connection timed out",
          74: "Text file busy",
          75: "Cross-device link",
          100: "Device not a stream",
          101: "Bad font file fmt",
          102: "Invalid slot",
          103: "Invalid request code",
          104: "No anode",
          105: "Block device required",
          106: "Channel number out of range",
          107: "Level 3 halted",
          108: "Level 3 reset",
          109: "Link number out of range",
          110: "Protocol driver not attached",
          111: "No CSI structure available",
          112: "Level 2 halted",
          113: "Invalid exchange",
          114: "Invalid request descriptor",
          115: "Exchange full",
          116: "No data (for no delay io)",
          117: "Timer expired",
          118: "Out of streams resources",
          119: "Machine is not on the network",
          120: "Package not installed",
          121: "The object is remote",
          122: "Advertise error",
          123: "Srmount error",
          124: "Communication error on send",
          125: "Cross mount point (not really error)",
          126: "Given log. name not unique",
          127: "f.d. invalid for this operation",
          128: "Remote address changed",
          129: "Can   access a needed shared lib",
          130: "Accessing a corrupted shared lib",
          131: ".lib section in a.out corrupted",
          132: "Attempting to link in too many libs",
          133: "Attempting to exec a shared library",
          135: "Streams pipe error",
          136: "Too many users",
          137: "Socket type not supported",
          138: "Not supported",
          139: "Protocol family not supported",
          140: "Can't send after socket shutdown",
          141: "Too many references",
          142: "Host is down",
          148: "No medium (in tape drive)",
          156: "Level 2 not synchronized"
        }, zb = {
          EPERM: 63,
          ENOENT: 44,
          ESRCH: 71,
          EINTR: 27,
          EIO: 29,
          ENXIO: 60,
          E2BIG: 1,
          ENOEXEC: 45,
          EBADF: 8,
          ECHILD: 12,
          EAGAIN: 6,
          EWOULDBLOCK: 6,
          ENOMEM: 48,
          EACCES: 2,
          EFAULT: 21,
          ENOTBLK: 105,
          EBUSY: 10,
          EEXIST: 20,
          EXDEV: 75,
          ENODEV: 43,
          ENOTDIR: 54,
          EISDIR: 31,
          EINVAL: 28,
          ENFILE: 41,
          EMFILE: 33,
          ENOTTY: 59,
          ETXTBSY: 74,
          EFBIG: 22,
          ENOSPC: 51,
          ESPIPE: 70,
          EROFS: 69,
          EMLINK: 34,
          EPIPE: 64,
          EDOM: 18,
          ERANGE: 68,
          ENOMSG: 49,
          EIDRM: 24,
          ECHRNG: 106,
          EL2NSYNC: 156,
          EL3HLT: 107,
          EL3RST: 108,
          ELNRNG: 109,
          EUNATCH: 110,
          ENOCSI: 111,
          EL2HLT: 112,
          EDEADLK: 16,
          ENOLCK: 46,
          EBADE: 113,
          EBADR: 114,
          EXFULL: 115,
          ENOANO: 104,
          EBADRQC: 103,
          EBADSLT: 102,
          EDEADLOCK: 16,
          EBFONT: 101,
          ENOSTR: 100,
          ENODATA: 116,
          ETIME: 117,
          ENOSR: 118,
          ENONET: 119,
          ENOPKG: 120,
          EREMOTE: 121,
          ENOLINK: 47,
          EADV: 122,
          ESRMNT: 123,
          ECOMM: 124,
          EPROTO: 65,
          EMULTIHOP: 36,
          EDOTDOT: 125,
          EBADMSG: 9,
          ENOTUNIQ: 126,
          EBADFD: 127,
          EREMCHG: 128,
          ELIBACC: 129,
          ELIBBAD: 130,
          ELIBSCN: 131,
          ELIBMAX: 132,
          ELIBEXEC: 133,
          ENOSYS: 52,
          ENOTEMPTY: 55,
          ENAMETOOLONG: 37,
          ELOOP: 32,
          EOPNOTSUPP: 138,
          EPFNOSUPPORT: 139,
          ECONNRESET: 15,
          ENOBUFS: 42,
          EAFNOSUPPORT: 5,
          EPROTOTYPE: 67,
          ENOTSOCK: 57,
          ENOPROTOOPT: 50,
          ESHUTDOWN: 140,
          ECONNREFUSED: 14,
          EADDRINUSE: 3,
          ECONNABORTED: 13,
          ENETUNREACH: 40,
          ENETDOWN: 38,
          ETIMEDOUT: 73,
          EHOSTDOWN: 142,
          EHOSTUNREACH: 23,
          EINPROGRESS: 26,
          EALREADY: 7,
          EDESTADDRREQ: 17,
          EMSGSIZE: 35,
          EPROTONOSUPPORT: 66,
          ESOCKTNOSUPPORT: 137,
          EADDRNOTAVAIL: 4,
          ENETRESET: 39,
          EISCONN: 30,
          ENOTCONN: 53,
          ETOOMANYREFS: 141,
          EUSERS: 136,
          EDQUOT: 19,
          ESTALE: 72,
          ENOTSUP: 138,
          ENOMEDIUM: 148,
          EILSEQ: 25,
          EOVERFLOW: 61,
          ECANCELED: 11,
          ENOTRECOVERABLE: 56,
          EOWNERDEAD: 62,
          ESTRPIPE: 135
        }, Ab = (a) => a.replace(/\b_Z[\w\d_]+/g, function(b) {
          Wa("warning: build with -sDEMANGLE_SUPPORT to link in libcxxabi demangling");
          return b === b ? b : b + " [" + b + "]";
        });
        function ob(a, b) {
          R.pa[a] = { l: b };
        }
        function T(a) {
          return (a & 61440) === 16384;
        }
        function U(a, b) {
          var c;
          if (c = (c = Bb(a, "x")) ? c : a.h.lookup ? 0 : 2)
            throw new R.g(c, a);
          for (c = R.F[Cb(a.id, b)];c; c = c.N) {
            var d = c.name;
            if (c.parent.id === a.id && d === b)
              return c;
          }
          return R.lookup(a, b);
        }
        function V(a, b = {}) {
          a = db(a);
          if (!a)
            return { path: "", node: null };
          b = Object.assign({ ba: true, ka: 0 }, b);
          if (8 < b.ka)
            throw new R.g(32);
          a = a.split("/").filter((m) => !!m);
          for (var c = R.root, d = "/", f = 0;f < a.length; f++) {
            var h = f === a.length - 1;
            if (h && b.parent)
              break;
            c = U(c, a[f]);
            d = P(d + "/" + a[f]);
            c.A && (!h || h && b.ba) && (c = c.A.root);
            if (!h || b.B) {
              for (h = 0;(c.mode & 61440) === 40960; )
                if (c = R.readlink(d), d = db($a(d), c), c = V(d, { ka: b.ka + 1 }).node, 40 < h++)
                  throw new R.g(32);
            }
          }
          return { path: d, node: c };
        }
        function Db(a) {
          for (var b;; ) {
            if (R.Z(a))
              return a = a.s.ua, b ? a[a.length - 1] !== "/" ? `${a}/${b}` : a + b : a;
            b = b ? `${a.name}/${b}` : a.name;
            a = a.parent;
          }
        }
        function Cb(a, b) {
          for (var c = 0, d = 0;d < b.length; d++)
            c = (c << 5) - c + b.charCodeAt(d) | 0;
          return (a + c >>> 0) % R.F.length;
        }
        function Eb(a) {
          var b = Cb(a.parent.id, a.name);
          a.N = R.F[b];
          R.F[b] = a;
        }
        function Fb(a) {
          var b = Cb(a.parent.id, a.name);
          if (R.F[b] === a)
            R.F[b] = a.N;
          else
            for (b = R.F[b];b; ) {
              if (b.N === a) {
                b.N = a.N;
                break;
              }
              b = b.N;
            }
        }
        function Gb(a) {
          var b = ["r", "w", "rw"][a & 3];
          a & 512 && (b += "w");
          return b;
        }
        function Bb(a, b) {
          if (R.ta)
            return 0;
          if (!b.includes("r") || a.mode & 292) {
            if (b.includes("w") && !(a.mode & 146) || b.includes("x") && !(a.mode & 73))
              return 2;
          } else
            return 2;
          return 0;
        }
        function Hb(a, b) {
          try {
            return U(a, b), 20;
          } catch (c) {}
          return Bb(a, "wx");
        }
        function Ib(a, b, c) {
          try {
            var d = U(a, b);
          } catch (f) {
            return f.u;
          }
          if (a = Bb(a, "wx"))
            return a;
          if (c) {
            if (!T(d.mode))
              return 54;
            if (R.Z(d) || Db(d) === R.cwd())
              return 10;
          } else if (T(d.mode))
            return 31;
          return 0;
        }
        function Jb() {
          for (var a = 0;a <= R.xa; a++)
            if (!R.streams[a])
              return a;
          throw new R.g(33);
        }
        function W(a) {
          a = R.qa(a);
          if (!a)
            throw new R.g(8);
          return a;
        }
        function Kb(a, b = -1) {
          R.X || (R.X = function() {
            this.I = {};
          }, R.X.prototype = {}, Object.defineProperties(R.X.prototype, { object: { get() {
            return this.node;
          }, set(c) {
            this.node = c;
          } }, flags: { get() {
            return this.I.flags;
          }, set(c) {
            this.I.flags = c;
          } }, position: { get() {
            return this.I.position;
          }, set(c) {
            this.I.position = c;
          } } }));
          a = Object.assign(new R.X, a);
          b == -1 && (b = Jb());
          a.fd = b;
          return R.streams[b] = a;
        }
        function Lb(a) {
          var b = [];
          for (a = [a];a.length; ) {
            var c = a.pop();
            b.push(c);
            a.push.apply(a, c.U);
          }
          return b;
        }
        function Mb(a, b, c) {
          typeof c == "undefined" && (c = b, b = 438);
          return R.J(a, b | 8192, c);
        }
        function Nb() {
          R.g || (R.g = function(a, b) {
            this.name = "ErrnoError";
            this.node = b;
            this.Sa = function(c) {
              this.u = c;
              for (var d in zb)
                if (zb[d] === c) {
                  this.code = d;
                  break;
                }
            };
            this.Sa(a);
            this.message = yb[a];
            this.stack && (Object.defineProperty(this, "stack", { value: Error().stack, writable: true }), this.stack = Ab(this.stack));
          }, R.g.prototype = Error(), R.g.prototype.constructor = R.g, [44].forEach((a) => {
            R.da[a] = new R.g(a);
            R.da[a].stack = "<generic error, no stack>";
          }));
        }
        function Ob(a, b) {
          try {
            var c = V(a, { B: !b });
            a = c.path;
          } catch (f) {}
          var d = { Z: false, exists: false, error: 0, name: null, path: null, object: null, Oa: false, Qa: null, Pa: null };
          try {
            c = V(a, { parent: true }), d.Oa = true, d.Qa = c.path, d.Pa = c.node, d.name = Q(a), c = V(a, { B: !b }), d.exists = true, d.path = c.path, d.object = c.node, d.name = c.node.name, d.Z = c.path === "/";
          } catch (f) {
            d.error = f.u;
          }
          return d;
        }
        function Pb(a, b, c, d) {
          a = typeof a == "string" ? a : Db(a);
          b = P(a + "/" + b);
          return R.create(b, xb(c, d));
        }
        function Qb(a) {
          if (!(a.La || a.Ma || a.link || a.m)) {
            if (typeof XMLHttpRequest != "undefined")
              throw Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
            if (ia)
              try {
                a.m = lb(ia(a.url), true), a.o = a.m.length;
              } catch (b) {
                throw new R.g(29);
              }
            else
              throw Error("Cannot load without read() or XMLHttpRequest.");
          }
        }
        var R = {
          root: null,
          U: [],
          pa: {},
          streams: [],
          Na: 1,
          F: null,
          oa: "/",
          Y: false,
          ta: true,
          g: null,
          da: {},
          Fa: null,
          W: 0,
          createNode(a, b, c, d) {
            u(typeof a == "object");
            a = new R.wa(a, b, c, d);
            Eb(a);
            return a;
          },
          Z(a) {
            return a === a.parent;
          },
          isFile(a) {
            return (a & 61440) === 32768;
          },
          isFIFO(a) {
            return (a & 61440) === 4096;
          },
          isSocket(a) {
            return (a & 49152) === 49152;
          },
          xa: 4096,
          qa: (a) => R.streams[a],
          Da: { open(a) {
            a.l = R.Ga(a.node.rdev).l;
            a.l.open && a.l.open(a);
          }, D() {
            throw new R.g(70);
          } },
          ha: (a) => a >> 8,
          nb: (a) => a & 255,
          M: (a, b) => a << 8 | b,
          Ga: (a) => R.pa[a],
          va(a, b) {
            function c(m) {
              u(0 < R.W);
              R.W--;
              return b(m);
            }
            function d(m) {
              if (m) {
                if (!d.Ea)
                  return d.Ea = true, c(m);
              } else
                ++h >= f.length && c(null);
            }
            typeof a == "function" && (b = a, a = false);
            R.W++;
            1 < R.W && z(`warning: ${R.W} FS.syncfs operations in flight at once, probably just doing extra work`);
            var f = Lb(R.root.s), h = 0;
            f.forEach((m) => {
              if (!m.type.va)
                return d(null);
              m.type.va(m, a, d);
            });
          },
          s(a, b, c) {
            if (typeof a == "string")
              throw a;
            var d = c === "/", f = !c;
            if (d && R.root)
              throw new R.g(10);
            if (!d && !f) {
              var h = V(c, { ba: false });
              c = h.path;
              h = h.node;
              if (h.A)
                throw new R.g(10);
              if (!T(h.mode))
                throw new R.g(54);
            }
            b = { type: a, rb: b, ua: c, U: [] };
            a = a.s(b);
            a.s = b;
            b.root = a;
            d ? R.root = a : h && (h.A = b, h.s && h.s.U.push(b));
            return a;
          },
          xb(a) {
            a = V(a, { ba: false });
            if (!a.node.A)
              throw new R.g(28);
            a = a.node;
            var b = a.A, c = Lb(b);
            Object.keys(R.F).forEach((d) => {
              for (d = R.F[d];d; ) {
                var f = d.N;
                c.includes(d.s) && Fb(d);
                d = f;
              }
            });
            a.A = null;
            b = a.s.U.indexOf(b);
            u(b !== -1);
            a.s.U.splice(b, 1);
          },
          lookup(a, b) {
            return a.h.lookup(a, b);
          },
          J(a, b, c) {
            var d = V(a, { parent: true }).node;
            a = Q(a);
            if (!a || a === "." || a === "..")
              throw new R.g(28);
            var f = Hb(d, a);
            if (f)
              throw new R.g(f);
            if (!d.h.J)
              throw new R.g(63);
            return d.h.J(d, a, b, c);
          },
          create(a, b) {
            return R.J(a, (b !== undefined ? b : 438) & 4095 | 32768, 0);
          },
          mkdir(a, b) {
            return R.J(a, (b !== undefined ? b : 511) & 1023 | 16384, 0);
          },
          ob(a, b) {
            a = a.split("/");
            for (var c = "", d = 0;d < a.length; ++d)
              if (a[d]) {
                c += "/" + a[d];
                try {
                  R.mkdir(c, b);
                } catch (f) {
                  if (f.u != 20)
                    throw f;
                }
              }
          },
          symlink(a, b) {
            if (!db(a))
              throw new R.g(44);
            var c = V(b, { parent: true }).node;
            if (!c)
              throw new R.g(44);
            b = Q(b);
            var d = Hb(c, b);
            if (d)
              throw new R.g(d);
            if (!c.h.symlink)
              throw new R.g(63);
            return c.h.symlink(c, b, a);
          },
          rename(a, b) {
            var c = $a(a), d = $a(b), f = Q(a), h = Q(b);
            var m = V(a, { parent: true });
            var p = m.node;
            m = V(b, { parent: true });
            m = m.node;
            if (!p || !m)
              throw new R.g(44);
            if (p.s !== m.s)
              throw new R.g(75);
            var y = U(p, f);
            a = eb(a, d);
            if (a.charAt(0) !== ".")
              throw new R.g(28);
            a = eb(b, c);
            if (a.charAt(0) !== ".")
              throw new R.g(55);
            try {
              var q = U(m, h);
            } catch (x) {}
            if (y !== q) {
              b = T(y.mode);
              if (f = Ib(p, f, b))
                throw new R.g(f);
              if (f = q ? Ib(m, h, b) : Hb(m, h))
                throw new R.g(f);
              if (!p.h.rename)
                throw new R.g(63);
              if (y.A || q && q.A)
                throw new R.g(10);
              if (m !== p && (f = Bb(p, "w")))
                throw new R.g(f);
              Fb(y);
              try {
                p.h.rename(y, m, h);
              } catch (x) {
                throw x;
              } finally {
                Eb(y);
              }
            }
          },
          rmdir(a) {
            var b = V(a, { parent: true }).node;
            a = Q(a);
            var c = U(b, a), d = Ib(b, a, true);
            if (d)
              throw new R.g(d);
            if (!b.h.rmdir)
              throw new R.g(63);
            if (c.A)
              throw new R.g(10);
            b.h.rmdir(b, a);
            Fb(c);
          },
          readdir(a) {
            a = V(a, { B: true }).node;
            if (!a.h.readdir)
              throw new R.g(54);
            return a.h.readdir(a);
          },
          unlink(a) {
            var b = V(a, { parent: true }).node;
            if (!b)
              throw new R.g(44);
            a = Q(a);
            var c = U(b, a), d = Ib(b, a, false);
            if (d)
              throw new R.g(d);
            if (!b.h.unlink)
              throw new R.g(63);
            if (c.A)
              throw new R.g(10);
            b.h.unlink(b, a);
            Fb(c);
          },
          readlink(a) {
            a = V(a).node;
            if (!a)
              throw new R.g(44);
            if (!a.h.readlink)
              throw new R.g(28);
            return db(Db(a.parent), a.h.readlink(a));
          },
          stat(a, b) {
            a = V(a, { B: !b }).node;
            if (!a)
              throw new R.g(44);
            if (!a.h.C)
              throw new R.g(63);
            return a.h.C(a);
          },
          lstat(a) {
            return R.stat(a, true);
          },
          chmod(a, b, c) {
            a = typeof a == "string" ? V(a, { B: !c }).node : a;
            if (!a.h.v)
              throw new R.g(63);
            a.h.v(a, { mode: b & 4095 | a.mode & -4096, timestamp: Date.now() });
          },
          lchmod(a, b) {
            R.chmod(a, b, true);
          },
          fchmod(a, b) {
            a = W(a);
            R.chmod(a.node, b);
          },
          chown(a, b, c, d) {
            a = typeof a == "string" ? V(a, { B: !d }).node : a;
            if (!a.h.v)
              throw new R.g(63);
            a.h.v(a, { timestamp: Date.now() });
          },
          lchown(a, b, c) {
            R.chown(a, b, c, true);
          },
          fchown(a, b, c) {
            a = W(a);
            R.chown(a.node, b, c);
          },
          truncate(a, b) {
            if (0 > b)
              throw new R.g(28);
            a = typeof a == "string" ? V(a, { B: true }).node : a;
            if (!a.h.v)
              throw new R.g(63);
            if (T(a.mode))
              throw new R.g(31);
            if (!R.isFile(a.mode))
              throw new R.g(28);
            var c = Bb(a, "w");
            if (c)
              throw new R.g(c);
            a.h.v(a, { size: b, timestamp: Date.now() });
          },
          kb(a, b) {
            a = W(a);
            if ((a.flags & 2097155) === 0)
              throw new R.g(28);
            R.truncate(a.node, b);
          },
          yb(a, b, c) {
            a = V(a, { B: true }).node;
            a.h.v(a, { timestamp: Math.max(b, c) });
          },
          open(a, b, c) {
            if (a === "")
              throw new R.g(44);
            if (typeof b == "string") {
              var d = { r: 0, "r+": 2, w: 577, "w+": 578, a: 1089, "a+": 1090 }[b];
              if (typeof d == "undefined")
                throw Error(`Unknown file open mode: ${b}`);
              b = d;
            }
            c = b & 64 ? (typeof c == "undefined" ? 438 : c) & 4095 | 32768 : 0;
            if (typeof a == "object")
              var f = a;
            else {
              a = P(a);
              try {
                f = V(a, { B: !(b & 131072) }).node;
              } catch (h) {}
            }
            d = false;
            if (b & 64)
              if (f) {
                if (b & 128)
                  throw new R.g(20);
              } else
                f = R.J(a, c, 0), d = true;
            if (!f)
              throw new R.g(44);
            (f.mode & 61440) === 8192 && (b &= -513);
            if (b & 65536 && !T(f.mode))
              throw new R.g(54);
            if (!d && (c = f ? (f.mode & 61440) === 40960 ? 32 : T(f.mode) && (Gb(b) !== "r" || b & 512) ? 31 : Bb(f, Gb(b)) : 44))
              throw new R.g(c);
            b & 512 && !d && R.truncate(f, 0);
            b &= -131713;
            f = Kb({ node: f, path: Db(f), flags: b, seekable: true, position: 0, l: f.l, Xa: [], error: false });
            f.l.open && f.l.open(f);
            !e.logReadFiles || b & 1 || (R.ja || (R.ja = {}), (a in R.ja) || (R.ja[a] = 1));
            return f;
          },
          close(a) {
            if (a.fd === null)
              throw new R.g(8);
            a.ea && (a.ea = null);
            try {
              a.l.close && a.l.close(a);
            } catch (b) {
              throw b;
            } finally {
              R.streams[a.fd] = null;
            }
            a.fd = null;
          },
          D(a, b, c) {
            if (a.fd === null)
              throw new R.g(8);
            if (!a.seekable || !a.l.D)
              throw new R.g(70);
            if (c != 0 && c != 1 && c != 2)
              throw new R.g(28);
            a.position = a.l.D(a, b, c);
            a.Xa = [];
            return a.position;
          },
          read(a, b, c, d, f) {
            u(0 <= c);
            if (0 > d || 0 > f)
              throw new R.g(28);
            if (a.fd === null)
              throw new R.g(8);
            if ((a.flags & 2097155) === 1)
              throw new R.g(8);
            if (T(a.node.mode))
              throw new R.g(31);
            if (!a.l.read)
              throw new R.g(28);
            var h = typeof f != "undefined";
            if (!h)
              f = a.position;
            else if (!a.seekable)
              throw new R.g(70);
            b = a.l.read(a, b, c, d, f);
            h || (a.position += b);
            return b;
          },
          write(a, b, c, d, f, h) {
            u(0 <= c);
            if (0 > d || 0 > f)
              throw new R.g(28);
            if (a.fd === null)
              throw new R.g(8);
            if ((a.flags & 2097155) === 0)
              throw new R.g(8);
            if (T(a.node.mode))
              throw new R.g(31);
            if (!a.l.write)
              throw new R.g(28);
            a.seekable && a.flags & 1024 && R.D(a, 0, 2);
            var m = typeof f != "undefined";
            if (!m)
              f = a.position;
            else if (!a.seekable)
              throw new R.g(70);
            b = a.l.write(a, b, c, d, f, h);
            m || (a.position += b);
            return b;
          },
          T(a, b, c) {
            if (a.fd === null)
              throw new R.g(8);
            if (0 > b || 0 >= c)
              throw new R.g(28);
            if ((a.flags & 2097155) === 0)
              throw new R.g(8);
            if (!R.isFile(a.node.mode) && !T(a.node.mode))
              throw new R.g(43);
            if (!a.l.T)
              throw new R.g(138);
            a.l.T(a, b, c);
          },
          S(a, b, c, d, f) {
            if ((d & 2) !== 0 && (f & 2) === 0 && (a.flags & 2097155) !== 2)
              throw new R.g(2);
            if ((a.flags & 2097155) === 1)
              throw new R.g(2);
            if (!a.l.S)
              throw new R.g(43);
            return a.l.S(a, b, c, d, f);
          },
          V(a, b, c, d, f) {
            u(0 <= c);
            return a.l.V ? a.l.V(a, b, c, d, f) : 0;
          },
          qb: () => 0,
          fa(a, b, c) {
            if (!a.l.fa)
              throw new R.g(59);
            return a.l.fa(a, b, c);
          },
          readFile(a, b = {}) {
            b.flags = b.flags || 0;
            b.encoding = b.encoding || "binary";
            if (b.encoding !== "utf8" && b.encoding !== "binary")
              throw Error(`Invalid encoding type "${b.encoding}"`);
            var c, d = R.open(a, b.flags);
            a = R.stat(a).size;
            var f = new Uint8Array(a);
            R.read(d, f, 0, a, 0);
            b.encoding === "utf8" ? c = hb(f, 0) : b.encoding === "binary" && (c = f);
            R.close(d);
            return c;
          },
          writeFile(a, b, c = {}) {
            c.flags = c.flags || 577;
            a = R.open(a, c.flags, c.mode);
            if (typeof b == "string") {
              var d = new Uint8Array(jb(b) + 1);
              b = kb(b, d, 0, d.length);
              R.write(a, d, 0, b, undefined, c.Ca);
            } else if (ArrayBuffer.isView(b))
              R.write(a, b, 0, b.byteLength, undefined, c.Ca);
            else
              throw Error("Unsupported data type");
            R.close(a);
          },
          cwd: () => R.oa,
          chdir(a) {
            a = V(a, { B: true });
            if (a.node === null)
              throw new R.g(44);
            if (!T(a.node.mode))
              throw new R.g(54);
            var b = Bb(a.node, "x");
            if (b)
              throw new R.g(b);
            R.oa = a.path;
          },
          R(a, b, c) {
            u(!R.R.Y, "FS.init was previously called. If you want to initialize later with custom parameters, remove any earlier calls (note that one is automatically added to the generated code)");
            R.R.Y = true;
            Nb();
            e.stdin = a || e.stdin;
            e.stdout = b || e.stdout;
            e.stderr = c || e.stderr;
            e.stdin ? R.L("/dev", "stdin", e.stdin) : R.symlink("/dev/tty", "/dev/stdin");
            e.stdout ? R.L("/dev", "stdout", null, e.stdout) : R.symlink("/dev/tty", "/dev/stdout");
            e.stderr ? R.L("/dev", "stderr", null, e.stderr) : R.symlink("/dev/tty1", "/dev/stderr");
            a = R.open("/dev/stdin", 0);
            b = R.open("/dev/stdout", 1);
            c = R.open("/dev/stderr", 1);
            u(a.fd === 0, `invalid handle for stdin (${a.fd})`);
            u(b.fd === 1, `invalid handle for stdout (${b.fd})`);
            u(c.fd === 2, `invalid handle for stderr (${c.fd})`);
          },
          sb() {
            R.R.Y = false;
            Rb(0);
            for (var a = 0;a < R.streams.length; a++) {
              var b = R.streams[a];
              b && R.close(b);
            }
          },
          jb(a, b) {
            a = Ob(a, b);
            return a.exists ? a.object : null;
          },
          hb(a, b) {
            a = typeof a == "string" ? a : Db(a);
            for (b = b.split("/").reverse();b.length; ) {
              var c = b.pop();
              if (c) {
                var d = P(a + "/" + c);
                try {
                  R.mkdir(d);
                } catch (f) {}
                a = d;
              }
            }
            return d;
          },
          L(a, b, c, d) {
            a = ab(typeof a == "string" ? a : Db(a), b);
            b = xb(!!c, !!d);
            R.L.ha || (R.L.ha = 64);
            var f = R.M(R.L.ha++, 0);
            ob(f, { open(h) {
              h.seekable = false;
            }, close() {
              d && d.buffer && d.buffer.length && d(10);
            }, read(h, m, p, y) {
              for (var q = 0, x = 0;x < y; x++) {
                try {
                  var t = c();
                } catch (B) {
                  throw new R.g(29);
                }
                if (t === undefined && q === 0)
                  throw new R.g(6);
                if (t === null || t === undefined)
                  break;
                q++;
                m[p + x] = t;
              }
              q && (h.node.timestamp = Date.now());
              return q;
            }, write(h, m, p, y) {
              for (var q = 0;q < y; q++)
                try {
                  d(m[p + q]);
                } catch (x) {
                  throw new R.g(29);
                }
              y && (h.node.timestamp = Date.now());
              return q;
            } });
            return Mb(a, b, f);
          },
          fb(a, b, c, d, f) {
            function h() {
              this.ga = false;
              this.I = [];
            }
            function m(t, B, l, w, v) {
              t = t.node.m;
              if (v >= t.length)
                return 0;
              w = Math.min(t.length - v, w);
              u(0 <= w);
              if (t.slice)
                for (var A = 0;A < w; A++)
                  B[l + A] = t[v + A];
              else
                for (A = 0;A < w; A++)
                  B[l + A] = t.get(v + A);
              return w;
            }
            h.prototype.get = function(t) {
              if (!(t > this.length - 1 || 0 > t)) {
                var B = t % this.chunkSize;
                return this.sa(t / this.chunkSize | 0)[B];
              }
            };
            h.prototype.Ha = function(t) {
              this.sa = t;
            };
            h.prototype.ma = function() {
              var t = new XMLHttpRequest;
              t.open("HEAD", c, false);
              t.send(null);
              if (!(200 <= t.status && 300 > t.status || t.status === 304))
                throw Error("Couldn't load " + c + ". Status: " + t.status);
              var B = Number(t.getResponseHeader("Content-length")), l, w = (l = t.getResponseHeader("Accept-Ranges")) && l === "bytes";
              t = (l = t.getResponseHeader("Content-Encoding")) && l === "gzip";
              var v = 1048576;
              w || (v = B);
              var A = this;
              A.Ha((H) => {
                var N = H * v, O = (H + 1) * v - 1;
                O = Math.min(O, B - 1);
                if (typeof A.I[H] == "undefined") {
                  var fb = A.I;
                  if (N > O)
                    throw Error("invalid range (" + N + ", " + O + ") or no bytes requested!");
                  if (O > B - 1)
                    throw Error("only " + B + " bytes available! programmer error!");
                  var K = new XMLHttpRequest;
                  K.open("GET", c, false);
                  B !== v && K.setRequestHeader("Range", "bytes=" + N + "-" + O);
                  K.responseType = "arraybuffer";
                  K.overrideMimeType && K.overrideMimeType("text/plain; charset=x-user-defined");
                  K.send(null);
                  if (!(200 <= K.status && 300 > K.status || K.status === 304))
                    throw Error("Couldn't load " + c + ". Status: " + K.status);
                  N = K.response !== undefined ? new Uint8Array(K.response || []) : lb(K.responseText || "", true);
                  fb[H] = N;
                }
                if (typeof A.I[H] == "undefined")
                  throw Error("doXHR failed!");
                return A.I[H];
              });
              if (t || !B)
                v = B = 1, v = B = this.sa(0).length, qa("LazyFiles on gzip forces download of the whole file when length is accessed");
              this.za = B;
              this.ya = v;
              this.ga = true;
            };
            if (typeof XMLHttpRequest != "undefined") {
              if (!k)
                throw "Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc";
              var p = new h;
              Object.defineProperties(p, { length: { get: function() {
                this.ga || this.ma();
                return this.za;
              } }, chunkSize: { get: function() {
                this.ga || this.ma();
                return this.ya;
              } } });
              var y = undefined;
            } else
              y = c, p = undefined;
            var q = Pb(a, b, d, f);
            p ? q.m = p : y && (q.m = null, q.url = y);
            Object.defineProperties(q, { o: { get: function() {
              return this.m.length;
            } } });
            var x = {};
            Object.keys(q.l).forEach((t) => {
              var B = q.l[t];
              x[t] = function() {
                Qb(q);
                return B.apply(null, arguments);
              };
            });
            x.read = (t, B, l, w, v) => {
              Qb(q);
              return m(t, B, l, w, v);
            };
            x.S = (t, B, l) => {
              Qb(q);
              var w = sb();
              if (!w)
                throw new R.g(48);
              m(t, E, w, B, l);
              return { Ra: w, Aa: true };
            };
            q.l = x;
            return q;
          },
          Ya() {
            g("FS.absolutePath has been removed; use PATH_FS.resolve instead");
          },
          eb() {
            g("FS.createFolder has been removed; use FS.mkdir instead");
          },
          gb() {
            g("FS.createLink has been removed; use FS.symlink instead");
          },
          mb() {
            g("FS.joinPath has been removed; use PATH.join instead");
          },
          pb() {
            g("FS.mmapAlloc has been replaced by the top level function mmapAlloc");
          },
          vb() {
            g("FS.standardizePath has been removed; use PATH.normalize instead");
          }
        }, X = (a) => {
          u(typeof a == "number", `UTF8ToString expects a number (got ${typeof a})`);
          return a ? hb(ta, a) : "";
        };
        function Sb(a, b) {
          if (b.charAt(0) === "/")
            return b;
          a = a === -100 ? R.cwd() : W(a).path;
          if (b.length == 0)
            throw new R.g(44);
          return P(a + "/" + b);
        }
        var Tb = undefined;
        function Y() {
          u(Tb != null);
          var a = F[+Tb >> 2];
          Tb += 4;
          return a;
        }
        var Ub = (a, b, c) => {
          u(typeof c == "number", "stringToUTF8(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!");
          return kb(a, ta, b, c);
        }, Vb = (a) => a % 4 === 0 && (a % 100 !== 0 || a % 400 === 0), Wb = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335], Xb = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334], Zb = (a) => {
          var b = jb(a) + 1, c = Yb(b);
          c && Ub(a, c, b);
          return c;
        }, $b = {}, bc = () => {
          if (!ac) {
            var a = { USER: "web_user", LOGNAME: "web_user", PATH: "/", PWD: "/", HOME: "/home/web_user", LANG: (typeof navigator == "object" && navigator.languages && navigator.languages[0] || "C").replace("-", "_") + ".UTF-8", _: da || "./this.program" }, b;
            for (b in $b)
              $b[b] === undefined ? delete a[b] : a[b] = $b[b];
            var c = [];
            for (b in a)
              c.push(`${b}=${a[b]}`);
            ac = c;
          }
          return ac;
        }, ac, cc = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], dc = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], ec = (a, b) => {
          u(0 <= a.length, "writeArrayToMemory array must have a length (should be an array or typed array)");
          E.set(a, b);
        }, fc = [], Z, gc = (a) => {
          var b = fc[a];
          b || (a >= fc.length && (fc.length = a + 1), fc[a] = b = Z.get(a));
          u(Z.get(a) == b, "JavaScript-side Wasm function table mirror is out of date!");
          return b;
        }, hc = (a) => {
          var b = e["_" + a];
          u(b, "Cannot call unknown function " + a + ", make sure it is exported");
          return b;
        }, ic, jc = [];
        function kc(a, b, c, d) {
          a ||= this;
          this.parent = a;
          this.s = a.s;
          this.A = null;
          this.id = R.Na++;
          this.name = b;
          this.mode = c;
          this.h = {};
          this.l = {};
          this.rdev = d;
        }
        Object.defineProperties(kc.prototype, { read: { get: function() {
          return (this.mode & 365) === 365;
        }, set: function(a) {
          a ? this.mode |= 365 : this.mode &= -366;
        } }, write: { get: function() {
          return (this.mode & 146) === 146;
        }, set: function(a) {
          a ? this.mode |= 146 : this.mode &= -147;
        } }, Ma: { get: function() {
          return T(this.mode);
        } }, La: { get: function() {
          return (this.mode & 61440) === 8192;
        } } });
        R.wa = kc;
        R.ib = (a, b, c, d, f, h, m, p, y, q) => {
          function x(l) {
            function w(v) {
              q && q();
              if (!p) {
                var A = a, H = b;
                A && (A = typeof A == "string" ? A : Db(A), H = b ? P(A + "/" + b) : A);
                A = xb(d, f);
                H = R.create(H, A);
                if (v) {
                  if (typeof v == "string") {
                    for (var N = Array(v.length), O = 0, fb = v.length;O < fb; ++O)
                      N[O] = v.charCodeAt(O);
                    v = N;
                  }
                  R.chmod(H, A | 146);
                  N = R.open(H, 577);
                  R.write(N, v, 0, v.length, 0, y);
                  R.close(N);
                  R.chmod(H, A);
                }
              }
              h && h();
              Na(B);
            }
            wb(l, t, w, () => {
              m && m();
              Na(B);
            }) || w(l);
          }
          var t = b ? db(P(a + "/" + b)) : a, B = La(`cp ${t}`);
          Ma(B);
          typeof c == "string" ? ub(c, (l) => x(l), m) : x(c);
        };
        Nb();
        R.F = Array(4096);
        R.s(S, {}, "/");
        R.mkdir("/tmp");
        R.mkdir("/home");
        R.mkdir("/home/web_user");
        (function() {
          R.mkdir("/dev");
          ob(R.M(1, 3), { read: () => 0, write: (d, f, h, m) => m });
          Mb("/dev/null", R.M(1, 3));
          nb(R.M(5, 0), qb);
          nb(R.M(6, 0), rb);
          Mb("/dev/tty", R.M(5, 0));
          Mb("/dev/tty1", R.M(6, 0));
          var a = new Uint8Array(1024), b = 0, c = () => {
            b === 0 && (b = cb(a).byteLength);
            return a[--b];
          };
          R.L("/dev", "random", c);
          R.L("/dev", "urandom", c);
          R.mkdir("/dev/shm");
          R.mkdir("/dev/shm/tmp");
        })();
        (function() {
          R.mkdir("/proc");
          var a = R.mkdir("/proc/self");
          R.mkdir("/proc/self/fd");
          R.s({ s() {
            var b = R.createNode(a, "fd", 16895, 73);
            b.h = { lookup(c, d) {
              var f = W(+d);
              c = { parent: null, s: { ua: "fake" }, h: { readlink: () => f.path } };
              return c.parent = c;
            } };
            return b;
          } }, {}, "/proc/self/fd");
        })();
        R.Fa = { MEMFS: S };
        var oc = {
          __syscall_dup3: function(a, b, c) {
            try {
              var d = W(a);
              u(!c);
              if (d.fd === b)
                return -28;
              var f = R.qa(b);
              f && R.close(f);
              return Kb(d, b).fd;
            } catch (h) {
              if (typeof R == "undefined" || h.name !== "ErrnoError")
                throw h;
              return -h.u;
            }
          },
          __syscall_fcntl64: function(a, b, c) {
            Tb = c;
            try {
              var d = W(a);
              switch (b) {
                case 0:
                  var f = Y();
                  if (0 > f)
                    return -28;
                  for (;R.streams[f]; )
                    f++;
                  return Kb(d, f).fd;
                case 1:
                case 2:
                  return 0;
                case 3:
                  return d.flags;
                case 4:
                  return f = Y(), d.flags |= f, 0;
                case 5:
                  return f = Y(), ua[f + 0 >> 1] = 2, 0;
                case 6:
                case 7:
                  return 0;
                case 16:
                case 8:
                  return -28;
                case 9:
                  return F[lc() >> 2] = 28, -1;
                default:
                  return -28;
              }
            } catch (h) {
              if (typeof R == "undefined" || h.name !== "ErrnoError")
                throw h;
              return -h.u;
            }
          },
          __syscall_ioctl: function(a, b, c) {
            Tb = c;
            try {
              var d = W(a);
              switch (b) {
                case 21509:
                  return d.tty ? 0 : -59;
                case 21505:
                  if (!d.tty)
                    return -59;
                  if (d.tty.K.Ia) {
                    a = [3, 28, 127, 21, 4, 0, 1, 0, 17, 19, 26, 0, 18, 15, 23, 22, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
                    var f = Y();
                    F[f >> 2] = 25856;
                    F[f + 4 >> 2] = 5;
                    F[f + 8 >> 2] = 191;
                    F[f + 12 >> 2] = 35387;
                    for (var h = 0;32 > h; h++)
                      E[f + h + 17 >> 0] = a[h] || 0;
                  }
                  return 0;
                case 21510:
                case 21511:
                case 21512:
                  return d.tty ? 0 : -59;
                case 21506:
                case 21507:
                case 21508:
                  if (!d.tty)
                    return -59;
                  if (d.tty.K.Ja)
                    for (f = Y(), a = [], h = 0;32 > h; h++)
                      a.push(E[f + h + 17 >> 0]);
                  return 0;
                case 21519:
                  if (!d.tty)
                    return -59;
                  f = Y();
                  return F[f >> 2] = 0;
                case 21520:
                  return d.tty ? -28 : -59;
                case 21531:
                  return f = Y(), R.fa(d, b, f);
                case 21523:
                  if (!d.tty)
                    return -59;
                  d.tty.K.Ka && (h = [24, 80], f = Y(), ua[f >> 1] = h[0], ua[f + 2 >> 1] = h[1]);
                  return 0;
                case 21524:
                  return d.tty ? 0 : -59;
                case 21515:
                  return d.tty ? 0 : -59;
                default:
                  return -28;
              }
            } catch (m) {
              if (typeof R == "undefined" || m.name !== "ErrnoError")
                throw m;
              return -m.u;
            }
          },
          __syscall_openat: function(a, b, c, d) {
            Tb = d;
            try {
              b = X(b);
              b = Sb(a, b);
              var f = d ? Y() : 0;
              return R.open(b, c, f).fd;
            } catch (h) {
              if (typeof R == "undefined" || h.name !== "ErrnoError")
                throw h;
              return -h.u;
            }
          },
          __syscall_readlinkat: function(a, b, c, d) {
            try {
              b = X(b);
              b = Sb(a, b);
              if (0 >= d)
                return -28;
              var f = R.readlink(b), h = Math.min(d, jb(f)), m = E[c + h];
              Ub(f, c, d + 1);
              E[c + h] = m;
              return h;
            } catch (p) {
              if (typeof R == "undefined" || p.name !== "ErrnoError")
                throw p;
              return -p.u;
            }
          },
          __syscall_renameat: function(a, b, c, d) {
            try {
              return b = X(b), d = X(d), b = Sb(a, b), d = Sb(c, d), R.rename(b, d), 0;
            } catch (f) {
              if (typeof R == "undefined" || f.name !== "ErrnoError")
                throw f;
              return -f.u;
            }
          },
          __syscall_rmdir: function(a) {
            try {
              return a = X(a), R.rmdir(a), 0;
            } catch (b) {
              if (typeof R == "undefined" || b.name !== "ErrnoError")
                throw b;
              return -b.u;
            }
          },
          __syscall_unlinkat: function(a, b, c) {
            try {
              return b = X(b), b = Sb(a, b), c === 0 ? R.unlink(b) : c === 512 ? R.rmdir(b) : g("Invalid flags passed to unlinkat"), 0;
            } catch (d) {
              if (typeof R == "undefined" || d.name !== "ErrnoError")
                throw d;
              return -d.u;
            }
          },
          _emscripten_get_now_is_monotonic: () => 1,
          _emscripten_throw_longjmp: () => {
            throw Infinity;
          },
          _gmtime_js: function(a, b) {
            a = -9007199254740992 > a || 9007199254740992 < a ? NaN : Number(a);
            a = new Date(1000 * a);
            F[b >> 2] = a.getUTCSeconds();
            F[b + 4 >> 2] = a.getUTCMinutes();
            F[b + 8 >> 2] = a.getUTCHours();
            F[b + 12 >> 2] = a.getUTCDate();
            F[b + 16 >> 2] = a.getUTCMonth();
            F[b + 20 >> 2] = a.getUTCFullYear() - 1900;
            F[b + 24 >> 2] = a.getUTCDay();
            F[b + 28 >> 2] = (a.getTime() - Date.UTC(a.getUTCFullYear(), 0, 1, 0, 0, 0, 0)) / 86400000 | 0;
          },
          _localtime_js: function(a, b) {
            a = -9007199254740992 > a || 9007199254740992 < a ? NaN : Number(a);
            a = new Date(1000 * a);
            F[b >> 2] = a.getSeconds();
            F[b + 4 >> 2] = a.getMinutes();
            F[b + 8 >> 2] = a.getHours();
            F[b + 12 >> 2] = a.getDate();
            F[b + 16 >> 2] = a.getMonth();
            F[b + 20 >> 2] = a.getFullYear() - 1900;
            F[b + 24 >> 2] = a.getDay();
            F[b + 28 >> 2] = (Vb(a.getFullYear()) ? Wb : Xb)[a.getMonth()] + a.getDate() - 1 | 0;
            F[b + 36 >> 2] = -(60 * a.getTimezoneOffset());
            var c = new Date(a.getFullYear(), 6, 1).getTimezoneOffset(), d = new Date(a.getFullYear(), 0, 1).getTimezoneOffset();
            F[b + 32 >> 2] = (c != d && a.getTimezoneOffset() == Math.min(d, c)) | 0;
          },
          _mktime_js: function(a) {
            var b = new Date(F[a + 20 >> 2] + 1900, F[a + 16 >> 2], F[a + 12 >> 2], F[a + 8 >> 2], F[a + 4 >> 2], F[a >> 2], 0), c = F[a + 32 >> 2], d = b.getTimezoneOffset(), f = new Date(b.getFullYear(), 6, 1).getTimezoneOffset(), h = new Date(b.getFullYear(), 0, 1).getTimezoneOffset(), m = Math.min(h, f);
            0 > c ? F[a + 32 >> 2] = Number(f != h && m == d) : 0 < c != (m == d) && (f = Math.max(h, f), b.setTime(b.getTime() + 60000 * ((0 < c ? m : f) - d)));
            F[a + 24 >> 2] = b.getDay();
            F[a + 28 >> 2] = (Vb(b.getFullYear()) ? Wb : Xb)[b.getMonth()] + b.getDate() - 1 | 0;
            F[a >> 2] = b.getSeconds();
            F[a + 4 >> 2] = b.getMinutes();
            F[a + 8 >> 2] = b.getHours();
            F[a + 12 >> 2] = b.getDate();
            F[a + 16 >> 2] = b.getMonth();
            F[a + 20 >> 2] = b.getYear();
            a = b.getTime();
            isNaN(a) ? (F[lc() >> 2] = 61, a = -1) : a /= 1000;
            return BigInt(a);
          },
          _tzset_js: (a, b, c) => {
            function d(y) {
              return (y = y.toTimeString().match(/\(([A-Za-z ]+)\)$/)) ? y[1] : "GMT";
            }
            var f = new Date().getFullYear(), h = new Date(f, 0, 1), m = new Date(f, 6, 1);
            f = h.getTimezoneOffset();
            var p = m.getTimezoneOffset();
            G[a >> 2] = 60 * Math.max(f, p);
            F[b >> 2] = Number(f != p);
            a = d(h);
            b = d(m);
            a = Zb(a);
            b = Zb(b);
            p < f ? (G[c >> 2] = a, G[c + 4 >> 2] = b) : (G[c >> 2] = b, G[c + 4 >> 2] = a);
          },
          abort: () => {
            g("native code called abort()");
          },
          emscripten_date_now: () => Date.now(),
          emscripten_get_now: () => performance.now(),
          emscripten_resize_heap: (a) => {
            var b = ta.length;
            a >>>= 0;
            u(a > b);
            if (2147483648 < a)
              return z(`Cannot enlarge memory, requested ${a} bytes, but the limit is 2147483648 bytes!`), false;
            for (var c = 1;4 >= c; c *= 2) {
              var d = b * (1 + 0.2 / c);
              d = Math.min(d, a + 100663296);
              var f = Math;
              d = Math.max(a, d);
              f = f.min.call(f, 2147483648, d + (65536 - d % 65536) % 65536);
              a: {
                d = f;
                var h = ra.buffer, m = (d - h.byteLength + 65535) / 65536;
                try {
                  ra.grow(m);
                  ya();
                  var p = 1;
                  break a;
                } catch (y) {
                  z(`growMemory: Attempted to grow heap from ${h.byteLength} bytes to ${d} bytes, but got error: ${y}`);
                }
                p = undefined;
              }
              if (p)
                return true;
            }
            z(`Failed to grow the heap from ${b} bytes to ${f} bytes, not enough memory!`);
            return false;
          },
          environ_get: (a, b) => {
            var c = 0;
            bc().forEach((d, f) => {
              var h = b + c;
              f = G[a + 4 * f >> 2] = h;
              for (h = 0;h < d.length; ++h)
                u(d.charCodeAt(h) === (d.charCodeAt(h) & 255)), E[f++ >> 0] = d.charCodeAt(h);
              E[f >> 0] = 0;
              c += d.length + 1;
            });
            return 0;
          },
          environ_sizes_get: (a, b) => {
            var c = bc();
            G[a >> 2] = c.length;
            var d = 0;
            c.forEach((f) => d += f.length + 1);
            G[b >> 2] = d;
            return 0;
          },
          exit: (a) => {
            mc();
            sa = true;
            ea(a, new pa(a));
          },
          fd_close: function(a) {
            try {
              var b = W(a);
              R.close(b);
              return 0;
            } catch (c) {
              if (typeof R == "undefined" || c.name !== "ErrnoError")
                throw c;
              return c.u;
            }
          },
          fd_read: function(a, b, c, d) {
            try {
              a: {
                var f = W(a);
                a = b;
                for (var h, m = b = 0;m < c; m++) {
                  var p = G[a >> 2], y = G[a + 4 >> 2];
                  a += 8;
                  var q = R.read(f, E, p, y, h);
                  if (0 > q) {
                    var x = -1;
                    break a;
                  }
                  b += q;
                  if (q < y)
                    break;
                  typeof h !== "undefined" && (h += q);
                }
                x = b;
              }
              G[d >> 2] = x;
              return 0;
            } catch (t) {
              if (typeof R == "undefined" || t.name !== "ErrnoError")
                throw t;
              return t.u;
            }
          },
          fd_seek: function(a, b, c, d) {
            b = -9007199254740992 > b || 9007199254740992 < b ? NaN : Number(b);
            try {
              if (isNaN(b))
                return 61;
              var f = W(a);
              R.D(f, b, c);
              wa[d >> 3] = BigInt(f.position);
              f.ea && b === 0 && c === 0 && (f.ea = null);
              return 0;
            } catch (h) {
              if (typeof R == "undefined" || h.name !== "ErrnoError")
                throw h;
              return h.u;
            }
          },
          fd_write: function(a, b, c, d) {
            try {
              a: {
                var f = W(a);
                a = b;
                for (var h, m = b = 0;m < c; m++) {
                  var p = G[a >> 2], y = G[a + 4 >> 2];
                  a += 8;
                  var q = R.write(f, E, p, y, h);
                  if (0 > q) {
                    var x = -1;
                    break a;
                  }
                  b += q;
                  typeof h !== "undefined" && (h += q);
                }
                x = b;
              }
              G[d >> 2] = x;
              return 0;
            } catch (t) {
              if (typeof R == "undefined" || t.name !== "ErrnoError")
                throw t;
              return t.u;
            }
          },
          invoke_vii: nc,
          strftime: (a, b, c, d) => {
            function f(l, w, v) {
              for (l = typeof l == "number" ? l.toString() : l || "";l.length < w; )
                l = v[0] + l;
              return l;
            }
            function h(l, w) {
              return f(l, w, "0");
            }
            function m(l, w) {
              function v(H) {
                return 0 > H ? -1 : 0 < H ? 1 : 0;
              }
              var A;
              (A = v(l.getFullYear() - w.getFullYear())) === 0 && (A = v(l.getMonth() - w.getMonth())) === 0 && (A = v(l.getDate() - w.getDate()));
              return A;
            }
            function p(l) {
              switch (l.getDay()) {
                case 0:
                  return new Date(l.getFullYear() - 1, 11, 29);
                case 1:
                  return l;
                case 2:
                  return new Date(l.getFullYear(), 0, 3);
                case 3:
                  return new Date(l.getFullYear(), 0, 2);
                case 4:
                  return new Date(l.getFullYear(), 0, 1);
                case 5:
                  return new Date(l.getFullYear() - 1, 11, 31);
                case 6:
                  return new Date(l.getFullYear() - 1, 11, 30);
              }
            }
            function y(l) {
              var w = l.O;
              for (l = new Date(new Date(l.P + 1900, 0, 1).getTime());0 < w; ) {
                var v = l.getMonth(), A = (Vb(l.getFullYear()) ? cc : dc)[v];
                if (w > A - l.getDate())
                  w -= A - l.getDate() + 1, l.setDate(1), 11 > v ? l.setMonth(v + 1) : (l.setMonth(0), l.setFullYear(l.getFullYear() + 1));
                else {
                  l.setDate(l.getDate() + w);
                  break;
                }
              }
              v = new Date(l.getFullYear() + 1, 0, 4);
              w = p(new Date(l.getFullYear(), 0, 4));
              v = p(v);
              return 0 >= m(w, l) ? 0 >= m(v, l) ? l.getFullYear() + 1 : l.getFullYear() : l.getFullYear() - 1;
            }
            var q = G[d + 40 >> 2];
            d = { Va: F[d >> 2], Ua: F[d + 4 >> 2], $: F[d + 8 >> 2], la: F[d + 12 >> 2], aa: F[d + 16 >> 2], P: F[d + 20 >> 2], H: F[d + 24 >> 2], O: F[d + 28 >> 2], wb: F[d + 32 >> 2], Ta: F[d + 36 >> 2], Wa: q ? X(q) : "" };
            c = X(c);
            q = {
              "%c": "%a %b %d %H:%M:%S %Y",
              "%D": "%m/%d/%y",
              "%F": "%Y-%m-%d",
              "%h": "%b",
              "%r": "%I:%M:%S %p",
              "%R": "%H:%M",
              "%T": "%H:%M:%S",
              "%x": "%m/%d/%y",
              "%X": "%H:%M:%S",
              "%Ec": "%c",
              "%EC": "%C",
              "%Ex": "%m/%d/%y",
              "%EX": "%H:%M:%S",
              "%Ey": "%y",
              "%EY": "%Y",
              "%Od": "%d",
              "%Oe": "%e",
              "%OH": "%H",
              "%OI": "%I",
              "%Om": "%m",
              "%OM": "%M",
              "%OS": "%S",
              "%Ou": "%u",
              "%OU": "%U",
              "%OV": "%V",
              "%Ow": "%w",
              "%OW": "%W",
              "%Oy": "%y"
            };
            for (var x in q)
              c = c.replace(new RegExp(x, "g"), q[x]);
            var t = "Sunday Monday Tuesday Wednesday Thursday Friday Saturday".split(" "), B = "January February March April May June July August September October November December".split(" ");
            q = {
              "%a": (l) => t[l.H].substring(0, 3),
              "%A": (l) => t[l.H],
              "%b": (l) => B[l.aa].substring(0, 3),
              "%B": (l) => B[l.aa],
              "%C": (l) => h((l.P + 1900) / 100 | 0, 2),
              "%d": (l) => h(l.la, 2),
              "%e": (l) => f(l.la, 2, " "),
              "%g": (l) => y(l).toString().substring(2),
              "%G": (l) => y(l),
              "%H": (l) => h(l.$, 2),
              "%I": (l) => {
                l = l.$;
                l == 0 ? l = 12 : 12 < l && (l -= 12);
                return h(l, 2);
              },
              "%j": (l) => {
                for (var w = 0, v = 0;v <= l.aa - 1; w += (Vb(l.P + 1900) ? cc : dc)[v++])
                  ;
                return h(l.la + w, 3);
              },
              "%m": (l) => h(l.aa + 1, 2),
              "%M": (l) => h(l.Ua, 2),
              "%n": () => `
`,
              "%p": (l) => 0 <= l.$ && 12 > l.$ ? "AM" : "PM",
              "%S": (l) => h(l.Va, 2),
              "%t": () => "\t",
              "%u": (l) => l.H || 7,
              "%U": (l) => h(Math.floor((l.O + 7 - l.H) / 7), 2),
              "%V": (l) => {
                var w = Math.floor((l.O + 7 - (l.H + 6) % 7) / 7);
                2 >= (l.H + 371 - l.O - 2) % 7 && w++;
                if (w)
                  w == 53 && (v = (l.H + 371 - l.O) % 7, v == 4 || v == 3 && Vb(l.P) || (w = 1));
                else {
                  w = 52;
                  var v = (l.H + 7 - l.O - 1) % 7;
                  (v == 4 || v == 5 && Vb(l.P % 400 - 1)) && w++;
                }
                return h(w, 2);
              },
              "%w": (l) => l.H,
              "%W": (l) => h(Math.floor((l.O + 7 - (l.H + 6) % 7) / 7), 2),
              "%y": (l) => (l.P + 1900).toString().substring(2),
              "%Y": (l) => l.P + 1900,
              "%z": (l) => {
                l = l.Ta;
                var w = 0 <= l;
                l = Math.abs(l) / 60;
                return (w ? "+" : "-") + String("0000" + (l / 60 * 100 + l % 60)).slice(-4);
              },
              "%Z": (l) => l.Wa,
              "%%": () => "%"
            };
            c = c.replace(/%%/g, "\x00\x00");
            for (x in q)
              c.includes(x) && (c = c.replace(new RegExp(x, "g"), q[x](d)));
            c = c.replace(/\0\0/g, "%");
            x = lb(c, false);
            if (x.length > b)
              return 0;
            ec(x, a);
            return x.length - 1;
          },
          system: (a) => {
            if (n) {
              if (!a)
                return 1;
              a = X(a);
              if (!a.length)
                return 0;
              a = require$1("child_process").ub(a, [], { tb: true, stdio: "inherit" });
              var b = (c, d) => c << 8 | d;
              return a.status === null ? b(0, ((c) => {
                switch (c) {
                  case "SIGHUP":
                    return 1;
                  case "SIGQUIT":
                    return 3;
                  case "SIGFPE":
                    return 8;
                  case "SIGKILL":
                    return 9;
                  case "SIGALRM":
                    return 14;
                  case "SIGTERM":
                    return 15;
                }
                return 2;
              })(a.signal)) : a.status << 8 | 0;
            }
            if (!a)
              return 0;
            F[lc() >> 2] = 52;
            return -1;
          }
        }, L = function() {
          var a = { env: oc, wasi_snapshot_preview1: oc };
          Ma("wasm-instantiate");
          var b = e;
          Ta(a, function(c) {
            u(e === b, "the Module object should not be replaced during async compilation - perhaps the order of HTML elements is wrong?");
            b = null;
            L = c.instance.exports;
            ra = L.memory;
            u(ra, "memory not found in wasm exports");
            ya();
            Z = L.__indirect_function_table;
            u(Z, "table not found in wasm exports");
            Fa.unshift(L.__wasm_call_ctors);
            Na("wasm-instantiate");
          }).catch(ba);
          return {};
        }();
        e._lua_checkstack = J("lua_checkstack");
        e._lua_xmove = J("lua_xmove");
        e._lua_atpanic = J("lua_atpanic");
        e._lua_version = J("lua_version");
        e._lua_absindex = J("lua_absindex");
        e._lua_gettop = J("lua_gettop");
        e._lua_settop = J("lua_settop");
        e._lua_closeslot = J("lua_closeslot");
        e._lua_rotate = J("lua_rotate");
        e._lua_copy = J("lua_copy");
        e._lua_pushvalue = J("lua_pushvalue");
        e._lua_type = J("lua_type");
        e._lua_typename = J("lua_typename");
        e._lua_iscfunction = J("lua_iscfunction");
        e._lua_isinteger = J("lua_isinteger");
        e._lua_isnumber = J("lua_isnumber");
        e._lua_isstring = J("lua_isstring");
        e._lua_isuserdata = J("lua_isuserdata");
        e._lua_rawequal = J("lua_rawequal");
        e._lua_arith = J("lua_arith");
        e._lua_compare = J("lua_compare");
        e._lua_stringtonumber = J("lua_stringtonumber");
        e._lua_tonumberx = J("lua_tonumberx");
        e._lua_tointegerx = J("lua_tointegerx");
        e._lua_toboolean = J("lua_toboolean");
        e._lua_tolstring = J("lua_tolstring");
        e._lua_rawlen = J("lua_rawlen");
        e._lua_tocfunction = J("lua_tocfunction");
        e._lua_touserdata = J("lua_touserdata");
        e._lua_tothread = J("lua_tothread");
        e._lua_topointer = J("lua_topointer");
        e._lua_pushnil = J("lua_pushnil");
        e._lua_pushnumber = J("lua_pushnumber");
        e._lua_pushinteger = J("lua_pushinteger");
        e._lua_pushlstring = J("lua_pushlstring");
        e._lua_pushstring = J("lua_pushstring");
        e._lua_pushcclosure = J("lua_pushcclosure");
        e._lua_pushboolean = J("lua_pushboolean");
        e._lua_pushlightuserdata = J("lua_pushlightuserdata");
        e._lua_pushthread = J("lua_pushthread");
        e._lua_getglobal = J("lua_getglobal");
        e._lua_gettable = J("lua_gettable");
        e._lua_getfield = J("lua_getfield");
        e._lua_geti = J("lua_geti");
        e._lua_rawget = J("lua_rawget");
        e._lua_rawgeti = J("lua_rawgeti");
        e._lua_rawgetp = J("lua_rawgetp");
        e._lua_createtable = J("lua_createtable");
        e._lua_getmetatable = J("lua_getmetatable");
        e._lua_getiuservalue = J("lua_getiuservalue");
        e._lua_setglobal = J("lua_setglobal");
        e._lua_settable = J("lua_settable");
        e._lua_setfield = J("lua_setfield");
        e._lua_seti = J("lua_seti");
        e._lua_rawset = J("lua_rawset");
        e._lua_rawsetp = J("lua_rawsetp");
        e._lua_rawseti = J("lua_rawseti");
        e._lua_setmetatable = J("lua_setmetatable");
        e._lua_setiuservalue = J("lua_setiuservalue");
        e._lua_callk = J("lua_callk");
        e._lua_pcallk = J("lua_pcallk");
        e._lua_load = J("lua_load");
        e._lua_dump = J("lua_dump");
        e._lua_status = J("lua_status");
        e._lua_error = J("lua_error");
        e._lua_next = J("lua_next");
        e._lua_toclose = J("lua_toclose");
        e._lua_concat = J("lua_concat");
        e._lua_len = J("lua_len");
        e._lua_getallocf = J("lua_getallocf");
        e._lua_setallocf = J("lua_setallocf");
        e._lua_setwarnf = J("lua_setwarnf");
        e._lua_warning = J("lua_warning");
        e._lua_newuserdatauv = J("lua_newuserdatauv");
        e._lua_getupvalue = J("lua_getupvalue");
        e._lua_setupvalue = J("lua_setupvalue");
        e._lua_upvalueid = J("lua_upvalueid");
        e._lua_upvaluejoin = J("lua_upvaluejoin");
        e._luaL_traceback = J("luaL_traceback");
        e._lua_getstack = J("lua_getstack");
        e._lua_getinfo = J("lua_getinfo");
        e._luaL_buffinit = J("luaL_buffinit");
        e._luaL_addstring = J("luaL_addstring");
        e._luaL_prepbuffsize = J("luaL_prepbuffsize");
        e._luaL_addvalue = J("luaL_addvalue");
        e._luaL_pushresult = J("luaL_pushresult");
        e._luaL_argerror = J("luaL_argerror");
        e._luaL_typeerror = J("luaL_typeerror");
        e._luaL_getmetafield = J("luaL_getmetafield");
        e._luaL_where = J("luaL_where");
        e._luaL_fileresult = J("luaL_fileresult");
        var lc = J("__errno_location");
        e._luaL_execresult = J("luaL_execresult");
        e._luaL_newmetatable = J("luaL_newmetatable");
        e._luaL_setmetatable = J("luaL_setmetatable");
        e._luaL_testudata = J("luaL_testudata");
        e._luaL_checkudata = J("luaL_checkudata");
        e._luaL_optlstring = J("luaL_optlstring");
        e._luaL_checklstring = J("luaL_checklstring");
        e._luaL_checkstack = J("luaL_checkstack");
        e._luaL_checktype = J("luaL_checktype");
        e._luaL_checkany = J("luaL_checkany");
        e._luaL_checknumber = J("luaL_checknumber");
        e._luaL_optnumber = J("luaL_optnumber");
        e._luaL_checkinteger = J("luaL_checkinteger");
        e._luaL_optinteger = J("luaL_optinteger");
        e._luaL_setfuncs = J("luaL_setfuncs");
        e._luaL_addlstring = J("luaL_addlstring");
        e._luaL_pushresultsize = J("luaL_pushresultsize");
        e._luaL_buffinitsize = J("luaL_buffinitsize");
        e._luaL_ref = J("luaL_ref");
        e._luaL_unref = J("luaL_unref");
        e._luaL_loadfilex = J("luaL_loadfilex");
        e._luaL_loadbufferx = J("luaL_loadbufferx");
        e._luaL_loadstring = J("luaL_loadstring");
        e._luaL_callmeta = J("luaL_callmeta");
        e._luaL_len = J("luaL_len");
        e._luaL_tolstring = J("luaL_tolstring");
        e._luaL_getsubtable = J("luaL_getsubtable");
        e._luaL_requiref = J("luaL_requiref");
        e._luaL_addgsub = J("luaL_addgsub");
        e._luaL_gsub = J("luaL_gsub");
        e._luaL_newstate = J("luaL_newstate");
        e._lua_newstate = J("lua_newstate");
        e._free = J("free");
        e._realloc = J("realloc");
        var Rb = e._fflush = J("fflush");
        e._luaL_checkversion_ = J("luaL_checkversion_");
        e._luaopen_base = J("luaopen_base");
        e._luaopen_coroutine = J("luaopen_coroutine");
        e._lua_newthread = J("lua_newthread");
        e._lua_yieldk = J("lua_yieldk");
        e._lua_isyieldable = J("lua_isyieldable");
        e._lua_resetthread = J("lua_resetthread");
        e._lua_resume = J("lua_resume");
        e._luaopen_debug = J("luaopen_debug");
        e._lua_gethookmask = J("lua_gethookmask");
        e._lua_gethook = J("lua_gethook");
        e._lua_gethookcount = J("lua_gethookcount");
        e._lua_getlocal = J("lua_getlocal");
        e._lua_sethook = J("lua_sethook");
        e._lua_setlocal = J("lua_setlocal");
        e._lua_setcstacklimit = J("lua_setcstacklimit");
        var Yb = e._malloc = J("malloc");
        e._luaL_openlibs = J("luaL_openlibs");
        e._luaopen_package = J("luaopen_package");
        e._luaopen_table = J("luaopen_table");
        e._luaopen_io = J("luaopen_io");
        e._luaopen_os = J("luaopen_os");
        e._luaopen_string = J("luaopen_string");
        e._luaopen_math = J("luaopen_math");
        e._luaopen_utf8 = J("luaopen_utf8");
        e._lua_close = J("lua_close");
        var pc = J("setThrew"), qc = () => (qc = L.emscripten_stack_init)(), Aa = () => (Aa = L.emscripten_stack_get_end)(), rc = J("stackSave"), sc = J("stackRestore"), tc = J("stackAlloc");
        function nc(a, b, c) {
          var d = rc();
          try {
            gc(a)(b, c);
          } catch (f) {
            sc(d);
            if (f !== f + 0)
              throw f;
            pc(1, 0);
          }
        }
        e.ENV = $b;
        e.ccall = (a, b, c, d) => {
          var f = { string: (q) => {
            var x = 0;
            if (q !== null && q !== undefined && q !== 0) {
              x = jb(q) + 1;
              var t = tc(x);
              Ub(q, t, x);
              x = t;
            }
            return x;
          }, array: (q) => {
            var x = tc(q.length);
            ec(q, x);
            return x;
          } };
          a = hc(a);
          var h = [], m = 0;
          u(b !== "array", 'Return type should not be "array".');
          if (d)
            for (var p = 0;p < d.length; p++) {
              var y = f[c[p]];
              y ? (m === 0 && (m = rc()), h[p] = y(d[p])) : h[p] = d[p];
            }
          c = a.apply(null, h);
          return c = function(q) {
            m !== 0 && sc(m);
            return b === "string" ? X(q) : b === "boolean" ? !!q : q;
          }(c);
        };
        e.addFunction = (a, b) => {
          u(typeof a != "undefined");
          if (!ic) {
            ic = new WeakMap;
            var c = Z.length;
            if (ic)
              for (var d = 0;d < 0 + c; d++) {
                var f = gc(d);
                f && ic.set(f, d);
              }
          }
          if (c = ic.get(a) || 0)
            return c;
          if (jc.length)
            c = jc.pop();
          else {
            try {
              Z.grow(1);
            } catch (p) {
              if (!(p instanceof RangeError))
                throw p;
              throw "Unable to grow wasm table. Set ALLOW_TABLE_GROWTH.";
            }
            c = Z.length - 1;
          }
          try {
            d = c, Z.set(d, a), fc[d] = Z.get(d);
          } catch (p) {
            if (!(p instanceof TypeError))
              throw p;
            u(typeof b != "undefined", "Missing signature argument to addFunction: " + a);
            if (typeof WebAssembly.Function == "function") {
              d = WebAssembly.Function;
              f = { i: "i32", j: "i64", f: "f32", d: "f64", e: "externref", p: "i32" };
              for (var h = { parameters: [], results: b[0] == "v" ? [] : [f[b[0]]] }, m = 1;m < b.length; ++m)
                u(b[m] in f, "invalid signature char: " + b[m]), h.parameters.push(f[b[m]]);
              b = new d(h, a);
            } else {
              d = [1];
              f = b.slice(0, 1);
              b = b.slice(1);
              h = { i: 127, p: 127, j: 126, f: 125, d: 124, e: 111 };
              d.push(96);
              m = b.length;
              u(16384 > m);
              128 > m ? d.push(m) : d.push(m % 128 | 128, m >> 7);
              for (m = 0;m < b.length; ++m)
                u(b[m] in h, "invalid signature char: " + b[m]), d.push(h[b[m]]);
              f == "v" ? d.push(0) : d.push(1, h[f]);
              b = [0, 97, 115, 109, 1, 0, 0, 0, 1];
              f = d.length;
              u(16384 > f);
              128 > f ? b.push(f) : b.push(f % 128 | 128, f >> 7);
              b.push.apply(b, d);
              b.push(2, 7, 1, 1, 101, 1, 102, 0, 0, 7, 5, 1, 1, 102, 0, 0);
              b = new WebAssembly.Module(new Uint8Array(b));
              b = new WebAssembly.Instance(b, { e: { f: a } }).exports.f;
            }
            d = c;
            Z.set(d, b);
            fc[d] = Z.get(d);
          }
          ic.set(a, c);
          return c;
        };
        e.removeFunction = (a) => {
          ic.delete(gc(a));
          Z.set(a, null);
          fc[a] = Z.get(a);
          jc.push(a);
        };
        e.setValue = function(a, b, c = "i8") {
          c.endsWith("*") && (c = "*");
          switch (c) {
            case "i1":
              E[a >> 0] = b;
              break;
            case "i8":
              E[a >> 0] = b;
              break;
            case "i16":
              ua[a >> 1] = b;
              break;
            case "i32":
              F[a >> 2] = b;
              break;
            case "i64":
              wa[a >> 3] = BigInt(b);
              break;
            case "float":
              va[a >> 2] = b;
              break;
            case "double":
              xa[a >> 3] = b;
              break;
            case "*":
              G[a >> 2] = b;
              break;
            default:
              g(`invalid type for setValue: ${c}`);
          }
        };
        e.getValue = function(a, b = "i8") {
          b.endsWith("*") && (b = "*");
          switch (b) {
            case "i1":
              return E[a >> 0];
            case "i8":
              return E[a >> 0];
            case "i16":
              return ua[a >> 1];
            case "i32":
              return F[a >> 2];
            case "i64":
              return wa[a >> 3];
            case "float":
              return va[a >> 2];
            case "double":
              return xa[a >> 3];
            case "*":
              return G[a >> 2];
            default:
              g(`invalid type for getValue: ${b}`);
          }
        };
        e.stringToUTF8 = Ub;
        e.lengthBytesUTF8 = jb;
        e.stringToNewUTF8 = Zb;
        e.FS = R;
        "writeI53ToI64 writeI53ToI64Clamped writeI53ToI64Signaling writeI53ToU64Clamped writeI53ToU64Signaling readI53FromI64 readI53FromU64 convertI32PairToI53 convertI32PairToI53Checked convertU32PairToI53 inetPton4 inetNtop4 inetPton6 inetNtop6 readSockaddr writeSockaddr getHostByName getCallstack emscriptenLog convertPCtoSourceLocation readEmAsmArgs jstoi_q jstoi_s listenOnce autoResumeAudioContext getDynCaller dynCall handleException runtimeKeepalivePush runtimeKeepalivePop callUserCallback maybeExit asmjsMangle handleAllocatorInit HandleAllocator getNativeTypeSize STACK_SIZE STACK_ALIGN POINTER_SIZE ASSERTIONS cwrap reallyNegative unSign strLen reSign formatString intArrayToString AsciiToString UTF16ToString stringToUTF16 lengthBytesUTF16 UTF32ToString stringToUTF32 lengthBytesUTF32 registerKeyEventCallback maybeCStringToJsString findEventTarget findCanvasEventTarget getBoundingClientRect fillMouseEventData registerMouseEventCallback registerWheelEventCallback registerUiEventCallback registerFocusEventCallback fillDeviceOrientationEventData registerDeviceOrientationEventCallback fillDeviceMotionEventData registerDeviceMotionEventCallback screenOrientation fillOrientationChangeEventData registerOrientationChangeEventCallback fillFullscreenChangeEventData registerFullscreenChangeEventCallback JSEvents_requestFullscreen JSEvents_resizeCanvasForFullscreen registerRestoreOldStyle hideEverythingExceptGivenElement restoreHiddenElements setLetterbox softFullscreenResizeWebGLRenderTarget doRequestFullscreen fillPointerlockChangeEventData registerPointerlockChangeEventCallback registerPointerlockErrorEventCallback requestPointerLock fillVisibilityChangeEventData registerVisibilityChangeEventCallback registerTouchEventCallback fillGamepadEventData registerGamepadEventCallback registerBeforeUnloadEventCallback fillBatteryEventData battery registerBatteryEventCallback setCanvasElementSize getCanvasElementSize jsStackTrace stackTrace checkWasiClock wasiRightsToMuslOFlags wasiOFlagsToMuslOFlags createDyncallWrapper safeSetTimeout setImmediateWrapped clearImmediateWrapped polyfillSetImmediate getPromise makePromise idsToPromises makePromiseCallback setMainLoop getSocketFromFD getSocketAddress FS_unlink FS_mkdirTree _setNetworkCallback".split(" ").forEach(function(a) {
          typeof globalThis === "undefined" || Object.getOwnPropertyDescriptor(globalThis, a) || Object.defineProperty(globalThis, a, { configurable: true, get() {
            var b = `\`${a}\` is a library symbol and not included by default; add it to your library.js __deps or to DEFAULT_LIBRARY_FUNCS_TO_INCLUDE on the command line`, c = a;
            c.startsWith("_") || (c = "$" + a);
            b += ` (e.g. -sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE='${c}')`;
            Ua(a) && (b += ". Alternatively, forcing filesystem support (-sFORCE_FILESYSTEM) can export this for you");
            Wa(b);
          } });
          Xa(a);
        });
        "run addOnPreRun addOnInit addOnPreMain addOnExit addOnPostRun addRunDependency removeRunDependency FS_createFolder FS_createPath FS_createLazyFile FS_createLink FS_createDevice FS_readFile out err callMain abort wasmMemory wasmExports stackAlloc stackSave stackRestore getTempRet0 setTempRet0 writeStackCookie checkStackCookie MAX_INT53 MIN_INT53 bigintToI53Checked ptrToString zeroMemory exitJS getHeapMax growMemory MONTH_DAYS_REGULAR MONTH_DAYS_LEAP MONTH_DAYS_REGULAR_CUMULATIVE MONTH_DAYS_LEAP_CUMULATIVE isLeapYear ydayFromDate arraySum addDays ERRNO_CODES ERRNO_MESSAGES setErrNo DNS Protocols Sockets initRandomFill randomFill timers warnOnce UNWIND_CACHE readEmAsmArgsArray getExecutableName keepRuntimeAlive asyncLoad alignMemory mmapAlloc wasmTable noExitRuntime getCFunc uleb128Encode sigToWasmTypes generateFuncType convertJsFunctionToWasm freeTableIndexes functionsInTableMap getEmptyTableSlot updateTableMap getFunctionAddress PATH PATH_FS UTF8Decoder UTF8ArrayToString UTF8ToString stringToUTF8Array intArrayFromString stringToAscii UTF16Decoder stringToUTF8OnStack writeArrayToMemory JSEvents specialHTMLTargets currentFullscreenStrategy restoreOldWindowedStyle demangle demangleAll ExitStatus getEnvStrings doReadv doWritev promiseMap Browser wget SYSCALLS preloadPlugins FS_createPreloadedFile FS_modeStringToFlags FS_getMode FS_stdin_getChar_buffer FS_stdin_getChar FS_createDataFile MEMFS TTY PIPEFS SOCKFS".split(" ").forEach(Xa);
        var uc;
        Ja = function vc() {
          uc || wc();
          uc || (Ja = vc);
        };
        function wc() {
          if (!(0 < Ia)) {
            qc();
            var a = Aa();
            u((a & 3) == 0);
            a == 0 && (a += 4);
            G[a >> 2] = 34821223;
            G[a + 4 >> 2] = 2310721022;
            G[0] = 1668509029;
            if (e.preRun)
              for (typeof e.preRun == "function" && (e.preRun = [e.preRun]);e.preRun.length; )
                a = e.preRun.shift(), Ea.unshift(a);
            for (;0 < Ea.length; )
              Ea.shift()(e);
            if (!(0 < Ia)) {
              if (!uc && (uc = true, e.calledRun = true, !sa)) {
                u(!Ha);
                Ha = true;
                za();
                e.noFSInit || R.R.Y || R.R();
                for (R.ta = false;0 < Fa.length; )
                  Fa.shift()(e);
                aa(e);
                u(!e._main, 'compiled without a main, but one is present. if you added it from JS, use Module["onRuntimeInitialized"]');
                for (za();0 < Ga.length; )
                  Ga.shift()(e);
              }
              za();
            }
          }
        }
        function mc() {
          var a = qa, b = z, c = false;
          qa = z = () => {
            c = true;
          };
          try {
            Rb(0), ["stdout", "stderr"].forEach(function(d) {
              (d = Ob("/dev/" + d)) && (d = mb[d.object.rdev]) && d.output && d.output.length && (c = true);
            });
          } catch (d) {}
          qa = a;
          z = b;
          c && Wa("stdio streams had content in them that was not flushed. you should set EXIT_RUNTIME to 1 (see the Emscripten FAQ), or make sure to emit a newline when you printf etc.");
        }
        wc();
        return moduleArg.ready;
      };
    })();

    class LuaWasm {
      static async initialize(customWasmFileLocation, environmentVariables) {
        const module2 = await initWasmModule({
          locateFile: (path, scriptDirectory) => {
            return customWasmFileLocation || scriptDirectory + path;
          },
          preRun: (initializedModule) => {
            if (typeof environmentVariables === "object") {
              Object.entries(environmentVariables).forEach(([k, v]) => initializedModule.ENV[k] = v);
            }
          }
        });
        return new LuaWasm(module2);
      }
      constructor(module2) {
        this.referenceTracker = new WeakMap;
        this.referenceMap = new Map;
        this.availableReferences = [];
        this.module = module2;
        this.luaL_checkversion_ = this.cwrap("luaL_checkversion_", null, ["number", "number", "number"]);
        this.luaL_getmetafield = this.cwrap("luaL_getmetafield", "number", ["number", "number", "string"]);
        this.luaL_callmeta = this.cwrap("luaL_callmeta", "number", ["number", "number", "string"]);
        this.luaL_tolstring = this.cwrap("luaL_tolstring", "string", ["number", "number", "number"]);
        this.luaL_argerror = this.cwrap("luaL_argerror", "number", ["number", "number", "string"]);
        this.luaL_typeerror = this.cwrap("luaL_typeerror", "number", ["number", "number", "string"]);
        this.luaL_checklstring = this.cwrap("luaL_checklstring", "string", ["number", "number", "number"]);
        this.luaL_optlstring = this.cwrap("luaL_optlstring", "string", ["number", "number", "string", "number"]);
        this.luaL_checknumber = this.cwrap("luaL_checknumber", "number", ["number", "number"]);
        this.luaL_optnumber = this.cwrap("luaL_optnumber", "number", ["number", "number", "number"]);
        this.luaL_checkinteger = this.cwrap("luaL_checkinteger", "number", ["number", "number"]);
        this.luaL_optinteger = this.cwrap("luaL_optinteger", "number", ["number", "number", "number"]);
        this.luaL_checkstack = this.cwrap("luaL_checkstack", null, ["number", "number", "string"]);
        this.luaL_checktype = this.cwrap("luaL_checktype", null, ["number", "number", "number"]);
        this.luaL_checkany = this.cwrap("luaL_checkany", null, ["number", "number"]);
        this.luaL_newmetatable = this.cwrap("luaL_newmetatable", "number", ["number", "string"]);
        this.luaL_setmetatable = this.cwrap("luaL_setmetatable", null, ["number", "string"]);
        this.luaL_testudata = this.cwrap("luaL_testudata", "number", ["number", "number", "string"]);
        this.luaL_checkudata = this.cwrap("luaL_checkudata", "number", ["number", "number", "string"]);
        this.luaL_where = this.cwrap("luaL_where", null, ["number", "number"]);
        this.luaL_fileresult = this.cwrap("luaL_fileresult", "number", ["number", "number", "string"]);
        this.luaL_execresult = this.cwrap("luaL_execresult", "number", ["number", "number"]);
        this.luaL_ref = this.cwrap("luaL_ref", "number", ["number", "number"]);
        this.luaL_unref = this.cwrap("luaL_unref", null, ["number", "number", "number"]);
        this.luaL_loadfilex = this.cwrap("luaL_loadfilex", "number", ["number", "string", "string"]);
        this.luaL_loadbufferx = this.cwrap("luaL_loadbufferx", "number", ["number", "string|number", "number", "string|number", "string"]);
        this.luaL_loadstring = this.cwrap("luaL_loadstring", "number", ["number", "string"]);
        this.luaL_newstate = this.cwrap("luaL_newstate", "number", []);
        this.luaL_len = this.cwrap("luaL_len", "number", ["number", "number"]);
        this.luaL_addgsub = this.cwrap("luaL_addgsub", null, ["number", "string", "string", "string"]);
        this.luaL_gsub = this.cwrap("luaL_gsub", "string", ["number", "string", "string", "string"]);
        this.luaL_setfuncs = this.cwrap("luaL_setfuncs", null, ["number", "number", "number"]);
        this.luaL_getsubtable = this.cwrap("luaL_getsubtable", "number", ["number", "number", "string"]);
        this.luaL_traceback = this.cwrap("luaL_traceback", null, ["number", "number", "string", "number"]);
        this.luaL_requiref = this.cwrap("luaL_requiref", null, ["number", "string", "number", "number"]);
        this.luaL_buffinit = this.cwrap("luaL_buffinit", null, ["number", "number"]);
        this.luaL_prepbuffsize = this.cwrap("luaL_prepbuffsize", "string", ["number", "number"]);
        this.luaL_addlstring = this.cwrap("luaL_addlstring", null, ["number", "string", "number"]);
        this.luaL_addstring = this.cwrap("luaL_addstring", null, ["number", "string"]);
        this.luaL_addvalue = this.cwrap("luaL_addvalue", null, ["number"]);
        this.luaL_pushresult = this.cwrap("luaL_pushresult", null, ["number"]);
        this.luaL_pushresultsize = this.cwrap("luaL_pushresultsize", null, ["number", "number"]);
        this.luaL_buffinitsize = this.cwrap("luaL_buffinitsize", "string", ["number", "number", "number"]);
        this.lua_newstate = this.cwrap("lua_newstate", "number", ["number", "number"]);
        this.lua_close = this.cwrap("lua_close", null, ["number"]);
        this.lua_newthread = this.cwrap("lua_newthread", "number", ["number"]);
        this.lua_resetthread = this.cwrap("lua_resetthread", "number", ["number"]);
        this.lua_atpanic = this.cwrap("lua_atpanic", "number", ["number", "number"]);
        this.lua_version = this.cwrap("lua_version", "number", ["number"]);
        this.lua_absindex = this.cwrap("lua_absindex", "number", ["number", "number"]);
        this.lua_gettop = this.cwrap("lua_gettop", "number", ["number"]);
        this.lua_settop = this.cwrap("lua_settop", null, ["number", "number"]);
        this.lua_pushvalue = this.cwrap("lua_pushvalue", null, ["number", "number"]);
        this.lua_rotate = this.cwrap("lua_rotate", null, ["number", "number", "number"]);
        this.lua_copy = this.cwrap("lua_copy", null, ["number", "number", "number"]);
        this.lua_checkstack = this.cwrap("lua_checkstack", "number", ["number", "number"]);
        this.lua_xmove = this.cwrap("lua_xmove", null, ["number", "number", "number"]);
        this.lua_isnumber = this.cwrap("lua_isnumber", "number", ["number", "number"]);
        this.lua_isstring = this.cwrap("lua_isstring", "number", ["number", "number"]);
        this.lua_iscfunction = this.cwrap("lua_iscfunction", "number", ["number", "number"]);
        this.lua_isinteger = this.cwrap("lua_isinteger", "number", ["number", "number"]);
        this.lua_isuserdata = this.cwrap("lua_isuserdata", "number", ["number", "number"]);
        this.lua_type = this.cwrap("lua_type", "number", ["number", "number"]);
        this.lua_typename = this.cwrap("lua_typename", "string", ["number", "number"]);
        this.lua_tonumberx = this.cwrap("lua_tonumberx", "number", ["number", "number", "number"]);
        this.lua_tointegerx = this.cwrap("lua_tointegerx", "number", ["number", "number", "number"]);
        this.lua_toboolean = this.cwrap("lua_toboolean", "number", ["number", "number"]);
        this.lua_tolstring = this.cwrap("lua_tolstring", "string", ["number", "number", "number"]);
        this.lua_rawlen = this.cwrap("lua_rawlen", "number", ["number", "number"]);
        this.lua_tocfunction = this.cwrap("lua_tocfunction", "number", ["number", "number"]);
        this.lua_touserdata = this.cwrap("lua_touserdata", "number", ["number", "number"]);
        this.lua_tothread = this.cwrap("lua_tothread", "number", ["number", "number"]);
        this.lua_topointer = this.cwrap("lua_topointer", "number", ["number", "number"]);
        this.lua_arith = this.cwrap("lua_arith", null, ["number", "number"]);
        this.lua_rawequal = this.cwrap("lua_rawequal", "number", ["number", "number", "number"]);
        this.lua_compare = this.cwrap("lua_compare", "number", ["number", "number", "number", "number"]);
        this.lua_pushnil = this.cwrap("lua_pushnil", null, ["number"]);
        this.lua_pushnumber = this.cwrap("lua_pushnumber", null, ["number", "number"]);
        this.lua_pushinteger = this.cwrap("lua_pushinteger", null, ["number", "number"]);
        this.lua_pushlstring = this.cwrap("lua_pushlstring", "string", ["number", "string|number", "number"]);
        this.lua_pushstring = this.cwrap("lua_pushstring", "string", ["number", "string|number"]);
        this.lua_pushcclosure = this.cwrap("lua_pushcclosure", null, ["number", "number", "number"]);
        this.lua_pushboolean = this.cwrap("lua_pushboolean", null, ["number", "number"]);
        this.lua_pushlightuserdata = this.cwrap("lua_pushlightuserdata", null, ["number", "number"]);
        this.lua_pushthread = this.cwrap("lua_pushthread", "number", ["number"]);
        this.lua_getglobal = this.cwrap("lua_getglobal", "number", ["number", "string"]);
        this.lua_gettable = this.cwrap("lua_gettable", "number", ["number", "number"]);
        this.lua_getfield = this.cwrap("lua_getfield", "number", ["number", "number", "string"]);
        this.lua_geti = this.cwrap("lua_geti", "number", ["number", "number", "number"]);
        this.lua_rawget = this.cwrap("lua_rawget", "number", ["number", "number"]);
        this.lua_rawgeti = this.cwrap("lua_rawgeti", "number", ["number", "number", "number"]);
        this.lua_rawgetp = this.cwrap("lua_rawgetp", "number", ["number", "number", "number"]);
        this.lua_createtable = this.cwrap("lua_createtable", null, ["number", "number", "number"]);
        this.lua_newuserdatauv = this.cwrap("lua_newuserdatauv", "number", ["number", "number", "number"]);
        this.lua_getmetatable = this.cwrap("lua_getmetatable", "number", ["number", "number"]);
        this.lua_getiuservalue = this.cwrap("lua_getiuservalue", "number", ["number", "number", "number"]);
        this.lua_setglobal = this.cwrap("lua_setglobal", null, ["number", "string"]);
        this.lua_settable = this.cwrap("lua_settable", null, ["number", "number"]);
        this.lua_setfield = this.cwrap("lua_setfield", null, ["number", "number", "string"]);
        this.lua_seti = this.cwrap("lua_seti", null, ["number", "number", "number"]);
        this.lua_rawset = this.cwrap("lua_rawset", null, ["number", "number"]);
        this.lua_rawseti = this.cwrap("lua_rawseti", null, ["number", "number", "number"]);
        this.lua_rawsetp = this.cwrap("lua_rawsetp", null, ["number", "number", "number"]);
        this.lua_setmetatable = this.cwrap("lua_setmetatable", "number", ["number", "number"]);
        this.lua_setiuservalue = this.cwrap("lua_setiuservalue", "number", ["number", "number", "number"]);
        this.lua_callk = this.cwrap("lua_callk", null, ["number", "number", "number", "number", "number"]);
        this.lua_pcallk = this.cwrap("lua_pcallk", "number", ["number", "number", "number", "number", "number", "number"]);
        this.lua_load = this.cwrap("lua_load", "number", ["number", "number", "number", "string", "string"]);
        this.lua_dump = this.cwrap("lua_dump", "number", ["number", "number", "number", "number"]);
        this.lua_yieldk = this.cwrap("lua_yieldk", "number", ["number", "number", "number", "number"]);
        this.lua_resume = this.cwrap("lua_resume", "number", ["number", "number", "number", "number"]);
        this.lua_status = this.cwrap("lua_status", "number", ["number"]);
        this.lua_isyieldable = this.cwrap("lua_isyieldable", "number", ["number"]);
        this.lua_setwarnf = this.cwrap("lua_setwarnf", null, ["number", "number", "number"]);
        this.lua_warning = this.cwrap("lua_warning", null, ["number", "string", "number"]);
        this.lua_error = this.cwrap("lua_error", "number", ["number"]);
        this.lua_next = this.cwrap("lua_next", "number", ["number", "number"]);
        this.lua_concat = this.cwrap("lua_concat", null, ["number", "number"]);
        this.lua_len = this.cwrap("lua_len", null, ["number", "number"]);
        this.lua_stringtonumber = this.cwrap("lua_stringtonumber", "number", ["number", "string"]);
        this.lua_getallocf = this.cwrap("lua_getallocf", "number", ["number", "number"]);
        this.lua_setallocf = this.cwrap("lua_setallocf", null, ["number", "number", "number"]);
        this.lua_toclose = this.cwrap("lua_toclose", null, ["number", "number"]);
        this.lua_closeslot = this.cwrap("lua_closeslot", null, ["number", "number"]);
        this.lua_getstack = this.cwrap("lua_getstack", "number", ["number", "number", "number"]);
        this.lua_getinfo = this.cwrap("lua_getinfo", "number", ["number", "string", "number"]);
        this.lua_getlocal = this.cwrap("lua_getlocal", "string", ["number", "number", "number"]);
        this.lua_setlocal = this.cwrap("lua_setlocal", "string", ["number", "number", "number"]);
        this.lua_getupvalue = this.cwrap("lua_getupvalue", "string", ["number", "number", "number"]);
        this.lua_setupvalue = this.cwrap("lua_setupvalue", "string", ["number", "number", "number"]);
        this.lua_upvalueid = this.cwrap("lua_upvalueid", "number", ["number", "number", "number"]);
        this.lua_upvaluejoin = this.cwrap("lua_upvaluejoin", null, ["number", "number", "number", "number", "number"]);
        this.lua_sethook = this.cwrap("lua_sethook", null, ["number", "number", "number", "number"]);
        this.lua_gethook = this.cwrap("lua_gethook", "number", ["number"]);
        this.lua_gethookmask = this.cwrap("lua_gethookmask", "number", ["number"]);
        this.lua_gethookcount = this.cwrap("lua_gethookcount", "number", ["number"]);
        this.lua_setcstacklimit = this.cwrap("lua_setcstacklimit", "number", ["number", "number"]);
        this.luaopen_base = this.cwrap("luaopen_base", "number", ["number"]);
        this.luaopen_coroutine = this.cwrap("luaopen_coroutine", "number", ["number"]);
        this.luaopen_table = this.cwrap("luaopen_table", "number", ["number"]);
        this.luaopen_io = this.cwrap("luaopen_io", "number", ["number"]);
        this.luaopen_os = this.cwrap("luaopen_os", "number", ["number"]);
        this.luaopen_string = this.cwrap("luaopen_string", "number", ["number"]);
        this.luaopen_utf8 = this.cwrap("luaopen_utf8", "number", ["number"]);
        this.luaopen_math = this.cwrap("luaopen_math", "number", ["number"]);
        this.luaopen_debug = this.cwrap("luaopen_debug", "number", ["number"]);
        this.luaopen_package = this.cwrap("luaopen_package", "number", ["number"]);
        this.luaL_openlibs = this.cwrap("luaL_openlibs", null, ["number"]);
      }
      lua_remove(luaState, index) {
        this.lua_rotate(luaState, index, -1);
        this.lua_pop(luaState, 1);
      }
      lua_pop(luaState, count) {
        this.lua_settop(luaState, -count - 1);
      }
      luaL_getmetatable(luaState, name) {
        return this.lua_getfield(luaState, LUA_REGISTRYINDEX, name);
      }
      lua_yield(luaState, count) {
        return this.lua_yieldk(luaState, count, 0, null);
      }
      lua_upvalueindex(index) {
        return LUA_REGISTRYINDEX - index;
      }
      ref(data) {
        const existing = this.referenceTracker.get(data);
        if (existing) {
          existing.refCount++;
          return existing.index;
        }
        const availableIndex = this.availableReferences.pop();
        const index = availableIndex === undefined ? this.referenceMap.size + 1 : availableIndex;
        this.referenceMap.set(index, data);
        this.referenceTracker.set(data, {
          refCount: 1,
          index
        });
        this.lastRefIndex = index;
        return index;
      }
      unref(index) {
        const ref = this.referenceMap.get(index);
        if (ref === undefined) {
          return;
        }
        const metadata = this.referenceTracker.get(ref);
        if (metadata === undefined) {
          this.referenceTracker.delete(ref);
          this.availableReferences.push(index);
          return;
        }
        metadata.refCount--;
        if (metadata.refCount <= 0) {
          this.referenceTracker.delete(ref);
          this.referenceMap.delete(index);
          this.availableReferences.push(index);
        }
      }
      getRef(index) {
        return this.referenceMap.get(index);
      }
      getLastRefIndex() {
        return this.lastRefIndex;
      }
      printRefs() {
        for (const [key, value] of this.referenceMap.entries()) {
          console.log(key, value);
        }
      }
      cwrap(name, returnType, argTypes) {
        const hasStringOrNumber = argTypes.some((argType) => argType === "string|number");
        if (!hasStringOrNumber) {
          return (...args) => this.module.ccall(name, returnType, argTypes, args);
        }
        return (...args) => {
          const pointersToBeFreed = [];
          const resolvedArgTypes = argTypes.map((argType, i) => {
            var _a;
            if (argType === "string|number") {
              if (typeof args[i] === "number") {
                return "number";
              } else {
                if (((_a = args[i]) === null || _a === undefined ? undefined : _a.length) > 1024) {
                  const bufferPointer = this.module.stringToNewUTF8(args[i]);
                  args[i] = bufferPointer;
                  pointersToBeFreed.push(bufferPointer);
                  return "number";
                } else {
                  return "string";
                }
              }
            }
            return argType;
          });
          try {
            return this.module.ccall(name, returnType, resolvedArgTypes, args);
          } finally {
            for (const pointer of pointersToBeFreed) {
              this.module._free(pointer);
            }
          }
        };
      }
    }
    var version = "1.16.0";

    class LuaFactory {
      constructor(customWasmUri, environmentVariables) {
        var _a;
        if (customWasmUri === undefined) {
          const isBrowser = typeof window === "object" && typeof window.document !== "undefined" || typeof self === "object" && ((_a = self === null || self === undefined ? undefined : self.constructor) === null || _a === undefined ? undefined : _a.name) === "DedicatedWorkerGlobalScope";
          if (isBrowser) {
            customWasmUri = `https://unpkg.com/wasmoon@${version}/dist/glue.wasm`;
          }
        }
        this.luaWasmPromise = LuaWasm.initialize(customWasmUri, environmentVariables);
      }
      async mountFile(path, content) {
        this.mountFileSync(await this.getLuaModule(), path, content);
      }
      mountFileSync(luaWasm, path, content) {
        const fileSep = path.lastIndexOf("/");
        const file = path.substring(fileSep + 1);
        const body = path.substring(0, path.length - file.length - 1);
        if (body.length > 0) {
          const parts = body.split("/").reverse();
          let parent = "";
          while (parts.length) {
            const part = parts.pop();
            if (!part) {
              continue;
            }
            const current = `${parent}/${part}`;
            try {
              luaWasm.module.FS.mkdir(current);
            } catch (err) {}
            parent = current;
          }
        }
        luaWasm.module.FS.writeFile(path, content);
      }
      async createEngine(options = {}) {
        return new LuaEngine(await this.getLuaModule(), options);
      }
      async getLuaModule() {
        return this.luaWasmPromise;
      }
    }
    exports2.Decoration = Decoration;
    exports2.LUAI_MAXSTACK = LUAI_MAXSTACK;
    exports2.LUA_MULTRET = LUA_MULTRET;
    exports2.LUA_REGISTRYINDEX = LUA_REGISTRYINDEX;
    exports2.LuaEngine = LuaEngine;
    exports2.LuaFactory = LuaFactory;
    exports2.LuaGlobal = Global;
    exports2.LuaMultiReturn = MultiReturn;
    exports2.LuaRawResult = RawResult;
    exports2.LuaThread = Thread;
    exports2.LuaTimeoutError = LuaTimeoutError;
    exports2.LuaTypeExtension = LuaTypeExtension;
    exports2.LuaWasm = LuaWasm;
    exports2.PointerSize = PointerSize;
    exports2.decorate = decorate;
    exports2.decorateFunction = decorateFunction;
    exports2.decorateProxy = decorateProxy;
    exports2.decorateUserdata = decorateUserdata;
  });
});

// src/display/_glue-wasm-b64.ts
var exports__glue_wasm_b64 = {};
__export(exports__glue_wasm_b64, {
  GLUE_WASM_DATA_URI: () => GLUE_WASM_DATA_URI
});
var GLUE_WASM_DATA_URI = "data:application/wasm;base64,AGFzbQEAAAAB5wI2YAF/AX9gBH9/f38Bf2ADf39/AX9gAn9/AX9gAn9/AGADf39/AGABfwBgBH9/f38AYAV/f39/fwBgBX9/f39/AX9gAAF/YAV/fn5+fgBgAABgA39+fwF+YAF/AX5gAn9/AX5gA39/fgBgAXwBfGACfHwBfGAEf35+fwBgAAF8YAJ+fwBgAn98AGADf39+AX9gBn9/f39/fwF/YAJ/fwF8YAZ/f39/f38AYAd/f39/f39/AX9gAnx/AX9gA3x8fwF8YAJ8fwF8YAZ/fH9/f38Bf2AEf35/fwF/YAF/AXxgA39/fwF8YAN/f38BfmACf34AYAN/f3wBfGADf39+AX5gA398fwBgCX9/f39/f39/fwBgBH9/fn4AYAR/f35+AX5gBX9/f39/AX5gBH9/fn8AYAJ/fgF/YAJ+fgF+YAABfmADf35/AX9gAX4Bf2ACfn8Bf2AEfn5+fgF/YAN+fn4Bf2ACfn4BfAKcBRsDZW52BWFib3J0AAwDZW52Cmludm9rZV92aWkABQNlbnYIc3RyZnRpbWUAAQNlbnYGc3lzdGVtAAADZW52BGV4aXQABgNlbnYTZW1zY3JpcHRlbl9kYXRlX25vdwAUA2VudiBfZW1zY3JpcHRlbl9nZXRfbm93X2lzX21vbm90b25pYwAKA2VudhBfX3N5c2NhbGxfb3BlbmF0AAEDZW52EV9fc3lzY2FsbF9mY250bDY0AAIDZW52D19fc3lzY2FsbF9pb2N0bAACFndhc2lfc25hcHNob3RfcHJldmlldzEIZmRfd3JpdGUAARZ3YXNpX3NuYXBzaG90X3ByZXZpZXcxB2ZkX3JlYWQAARZ3YXNpX3NuYXBzaG90X3ByZXZpZXcxCGZkX2Nsb3NlAAADZW52Dl9fc3lzY2FsbF9kdXAzAAIWd2FzaV9zbmFwc2hvdF9wcmV2aWV3MRFlbnZpcm9uX3NpemVzX2dldAADFndhc2lfc25hcHNob3RfcHJldmlldzELZW52aXJvbl9nZXQAAxZ3YXNpX3NuYXBzaG90X3ByZXZpZXcxB2ZkX3NlZWsAIANlbnYKX21rdGltZV9qcwAOA2Vudg1fbG9jYWx0aW1lX2pzABUDZW52Cl9nbXRpbWVfanMAFQNlbnYSX19zeXNjYWxsX3VubGlua2F0AAIDZW52D19fc3lzY2FsbF9ybWRpcgAAA2VudhJfX3N5c2NhbGxfcmVuYW1lYXQAAQNlbnYUX19zeXNjYWxsX3JlYWRsaW5rYXQAAQNlbnYJX3R6c2V0X2pzAAUDZW52FmVtc2NyaXB0ZW5fcmVzaXplX2hlYXAAAANlbnYZX2Vtc2NyaXB0ZW5fdGhyb3dfbG9uZ2ptcAAMA5QFkgUMAwUDIQMABAQFBQQDAwMDAwMDAgQBAyIjAwIPAwMDAwYWJAIDAgUEBAADAwIXAxcCBQMCBAUEBRAEBwUQAwIIGAQJAQACAAMEBAQDBQUFAgICAggHAgMEBAMGBgICAgICBAIDAwQCAgEBAgUFBBklDwQmBQUEAgMFAgMCCQIDAg8CAgcHAQoBAAUFJwAFAAAAAAACAAAAAAACAAACAAIAAAAAAAAAAAAAAAAEAwkABQUIBAEEEAIFBAQFBQMEBAMFBAIEBQEEGigIBwcAAAACAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAHAAAAAgICAgIFAwcFAQUGBwUFAwUEAgICBgYIBAMFAQIFBQEEBAABAgQJBAUEAwQEAQACBQQEBAIFBAQDAAAEBgYABgQEAgUABAYAAAAAAAUABAAAAAAAAAIAAAACAAACAwAAAAAAAAAAAwQFAgYDBgAFAwAEAwApAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAbAQEJBgECAAAAAAAABwACAAkCAAAJKgMEAgUEAgUAAAAEAAAAAAAAAAACAAAGBgQFBgIEBQMBBAcHBAgEBAUHBAMABgYABAMDBAYGAwQCAwMAAAAAAQADAAAAAAIHAAAAAAAAAAAJAAArAwIABQAAAAAAAAAAAgcHAywAAy0DAwgOAAAEAAAAAAAABwICAgMICAkaARgFBAMAAAAAAAAAAAMDHAMICAIELgQAAgoRERIcHQovAAAAAAMSAA0CAgADAwIABAQEAh4wDgIBAAAUABECAhIxHgMDAQ0DAwMDAwAAAgMDAwALEwsOGR0GDAQJGwUABzIIHwQCAwAAAgAGAwsTMzQLBAEEFgQEEwsLCzUKBgAMCgoKBAUBcADGAQUHAQGAAoCAAgYYBH8BQcCSwgALfwFBAAt/AUEAC38BQQALB6gVpQEGbWVtb3J5AgARX193YXNtX2NhbGxfY3RvcnMAGw5sdWFfY2hlY2tzdGFjawAcCWx1YV94bW92ZQAdC2x1YV9hdHBhbmljAB4LbHVhX3ZlcnNpb24AHwxsdWFfYWJzaW5kZXgAIApsdWFfZ2V0dG9wACEKbHVhX3NldHRvcAAiDWx1YV9jbG9zZXNsb3QAIwpsdWFfcm90YXRlACQIbHVhX2NvcHkAJQ1sdWFfcHVzaHZhbHVlACYIbHVhX3R5cGUAJwxsdWFfdHlwZW5hbWUAKA9sdWFfaXNjZnVuY3Rpb24AKQ1sdWFfaXNpbnRlZ2VyACoMbHVhX2lzbnVtYmVyACsMbHVhX2lzc3RyaW5nACwObHVhX2lzdXNlcmRhdGEALQxsdWFfcmF3ZXF1YWwALglsdWFfYXJpdGgALwtsdWFfY29tcGFyZQAwEmx1YV9zdHJpbmd0b251bWJlcgAxDWx1YV90b251bWJlcngAMg5sdWFfdG9pbnRlZ2VyeAAzDWx1YV90b2Jvb2xlYW4ANA1sdWFfdG9sc3RyaW5nADUKbHVhX3Jhd2xlbgA2D2x1YV90b2NmdW5jdGlvbgA3Dmx1YV90b3VzZXJkYXRhADgMbHVhX3RvdGhyZWFkADkNbHVhX3RvcG9pbnRlcgA6C2x1YV9wdXNobmlsADsObHVhX3B1c2hudW1iZXIAPA9sdWFfcHVzaGludGVnZXIAPQ9sdWFfcHVzaGxzdHJpbmcAPg5sdWFfcHVzaHN0cmluZwA/EGx1YV9wdXNoY2Nsb3N1cmUAQQ9sdWFfcHVzaGJvb2xlYW4AQhVsdWFfcHVzaGxpZ2h0dXNlcmRhdGEAQw5sdWFfcHVzaHRocmVhZABEDWx1YV9nZXRnbG9iYWwARQxsdWFfZ2V0dGFibGUARgxsdWFfZ2V0ZmllbGQARwhsdWFfZ2V0aQBICmx1YV9yYXdnZXQASQtsdWFfcmF3Z2V0aQBKC2x1YV9yYXdnZXRwAEsPbHVhX2NyZWF0ZXRhYmxlAEwQbHVhX2dldG1ldGF0YWJsZQBNEWx1YV9nZXRpdXNlcnZhbHVlAE4NbHVhX3NldGdsb2JhbABPDGx1YV9zZXR0YWJsZQBRDGx1YV9zZXRmaWVsZABSCGx1YV9zZXRpAFMKbHVhX3Jhd3NldABUC2x1YV9yYXdzZXRwAFYLbHVhX3Jhd3NldGkAVxBsdWFfc2V0bWV0YXRhYmxlAFgRbHVhX3NldGl1c2VydmFsdWUAWQlsdWFfY2FsbGsAWgpsdWFfcGNhbGxrAFsIbHVhX2xvYWQAXQhsdWFfZHVtcABeCmx1YV9zdGF0dXMAXwlsdWFfZXJyb3IAYQhsdWFfbmV4dABiC2x1YV90b2Nsb3NlAGMKbHVhX2NvbmNhdABkB2x1YV9sZW4AZQ1sdWFfZ2V0YWxsb2NmAGYNbHVhX3NldGFsbG9jZgBnDGx1YV9zZXR3YXJuZgBoC2x1YV93YXJuaW5nAGkRbHVhX25ld3VzZXJkYXRhdXYAag5sdWFfZ2V0dXB2YWx1ZQBrDmx1YV9zZXR1cHZhbHVlAGwNbHVhX3VwdmFsdWVpZABtD2x1YV91cHZhbHVlam9pbgBuGV9faW5kaXJlY3RfZnVuY3Rpb25fdGFibGUBAA5sdWFMX3RyYWNlYmFjawBvDGx1YV9nZXRzdGFjawCJAgtsdWFfZ2V0aW5mbwCMAg1sdWFMX2J1ZmZpbml0AHIObHVhTF9hZGRzdHJpbmcAcxFsdWFMX3ByZXBidWZmc2l6ZQB0DWx1YUxfYWRkdmFsdWUAdQ9sdWFMX3B1c2hyZXN1bHQAdg1sdWFMX2FyZ2Vycm9yAHcObHVhTF90eXBlZXJyb3IAehFsdWFMX2dldG1ldGFmaWVsZAB7Cmx1YUxfd2hlcmUAfA9sdWFMX2ZpbGVyZXN1bHQAfRBfX2Vycm5vX2xvY2F0aW9uAMIED2x1YUxfZXhlY3Jlc3VsdAB+EWx1YUxfbmV3bWV0YXRhYmxlAH8RbHVhTF9zZXRtZXRhdGFibGUAgAEObHVhTF90ZXN0dWRhdGEAgQEPbHVhTF9jaGVja3VkYXRhAIIBD2x1YUxfb3B0bHN0cmluZwCEARFsdWFMX2NoZWNrbHN0cmluZwCFAQ9sdWFMX2NoZWNrc3RhY2sAhgEObHVhTF9jaGVja3R5cGUAhwENbHVhTF9jaGVja2FueQCIARBsdWFMX2NoZWNrbnVtYmVyAIkBDmx1YUxfb3B0bnVtYmVyAIoBEWx1YUxfY2hlY2tpbnRlZ2VyAIsBD2x1YUxfb3B0aW50ZWdlcgCNAQ1sdWFMX3NldGZ1bmNzAI4BD2x1YUxfYWRkbHN0cmluZwCPARNsdWFMX3B1c2hyZXN1bHRzaXplAJABEWx1YUxfYnVmZmluaXRzaXplAJEBCGx1YUxfcmVmAJIBCmx1YUxfdW5yZWYAkwEObHVhTF9sb2FkZmlsZXgAlAEQbHVhTF9sb2FkYnVmZmVyeACXAQ9sdWFMX2xvYWRzdHJpbmcAmQENbHVhTF9jYWxsbWV0YQCaAQhsdWFMX2xlbgCbAQ5sdWFMX3RvbHN0cmluZwCcARBsdWFMX2dldHN1YnRhYmxlAJ0BDWx1YUxfcmVxdWlyZWYAngEMbHVhTF9hZGRnc3ViAJ8BCWx1YUxfZ3N1YgCgAQ1sdWFMX25ld3N0YXRlAKEBDGx1YV9uZXdzdGF0ZQDdAwRmcmVlAJQFB3JlYWxsb2MAlQUGZmZsdXNoAMsEEmx1YUxfY2hlY2t2ZXJzaW9uXwCmAQxsdWFvcGVuX2Jhc2UAqQERbHVhb3Blbl9jb3JvdXRpbmUA5wENbHVhX25ld3RocmVhZADaAwpsdWFfeWllbGRrAKwCD2x1YV9pc3lpZWxkYWJsZQCrAg9sdWFfcmVzZXR0aHJlYWQA3AMKbHVhX3Jlc3VtZQCoAg1sdWFvcGVuX2RlYnVnAPIBD2x1YV9nZXRob29rbWFzawCHAgtsdWFfZ2V0aG9vawCGAhBsdWFfZ2V0aG9va2NvdW50AIgCDGx1YV9nZXRsb2NhbACKAgtsdWFfc2V0aG9vawCFAgxsdWFfc2V0bG9jYWwAiwISbHVhX3NldGNzdGFja2xpbWl0ANYDBm1hbGxvYwCTBQ1sdWFMX29wZW5saWJzAM8CD2x1YW9wZW5fcGFja2FnZQCcAw1sdWFvcGVuX3RhYmxlAJcECmx1YW9wZW5faW8A0AIKbHVhb3Blbl9vcwCzAw5sdWFvcGVuX3N0cmluZwDmAwxsdWFvcGVuX21hdGgA/AIMbHVhb3Blbl91dGY4AK4ECWx1YV9jbG9zZQDgAwhzZXRUaHJldwCbBRVlbXNjcmlwdGVuX3N0YWNrX2luaXQAqQUZZW1zY3JpcHRlbl9zdGFja19nZXRfZnJlZQCqBRllbXNjcmlwdGVuX3N0YWNrX2dldF9iYXNlAKsFGGVtc2NyaXB0ZW5fc3RhY2tfZ2V0X2VuZACsBQlzdGFja1NhdmUApgUMc3RhY2tSZXN0b3JlAKcFCnN0YWNrQWxsb2MAqAUcZW1zY3JpcHRlbl9zdGFja19nZXRfY3VycmVudACmBQmQAwEAQQELxQFclgGYAaIBowGkAaUB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AQJAIAAoAggiAygCCCIGIAAoAhhrIgQgBEEfdSIFcyAFa0H/AE0EQCAAIAAsADUiBUEBajoANSAFQQBODQELIAIgAygCNCACKAJEIAAoAiQgAkEkakEIQf////8BQb0REJUDIgM2AkQgAyAAKAIkIgRBA3RqIgMgATYCACAAIARBAWo2AiQgAyAGNgIEIABBAToANSAAKAIIIQNBgH8hBAsgAiADKAI0IAIoAkAgASACQRhqQQFB/////wdB0xEQlQMiAjYCQCABIAJqIAQ6AAAgACAGNgIYIAAoAhBBAWsLGwAgACACQQd0IAFyIANBEHRyIARBGHRyEMcBCw0AIABBuP7//wcQxwELKwAgACACQRB0QYCABGogAUEHdEHIAEHGACACQQFGG0HHACACG3JyEMcBGgsQACAAIAEgAkH/ASACEMwBC9ICAQd/AkACQAJAIAFBf0YNACADQQd0QYD/AXEhCSAAKAIAKAI0IQogA0H/AUYhCwNAIAogAUECdGoiCCgCACEGAkAgAUEASgRAIAhBBGsiBygCACIFQf8AcUHw1QBqLQAAQRBxDQELIAYhBSAIIQcLAkAgBUH/AHFBwwBGBEAgBwJ/AkAgCw0AIAVBEHZB/wFxIANGDQAgBUH/gH5xIAlyDAELIAVBgIACcSAFQQl2QYD/AXFyQcIAcgs2AgAgAUF/cyACaiIFQf///wdqQYCAgBBPDQQgCCgCACEHDAELIAYhByABQX9zIARqIgVB////B2pBgICAEE8NBAsgCCAHQf8AcSAFQQd0ckGA////B2o2AgAgBkEHdkH///8HayIGQX9GDQEgASAGakEBaiIBQX9HDQALCw8LIAAoAghBnyEQ8AIACyAAKAIIQZ8hEPACAAseAQF/IAAgACgCECICNgIUIAAgASACQf8BIAIQzAELFQAgACACQQd0IAFyIANBD3RyEMcBC0IBAX8CQCAALQA0IAFqIgEgACgCACICLQAISgRAIAFB/wFODQEgAiABOgAICyAAIAE6ADQPCyAAKAIIQfkOEPACAAuZAQECfyMAQRBrIgMkAAJAIAJCgYAEfUKAgHhaBEAgACACp0EPdEGAgP7/B2ogAUEHdHJBAXIQxwEaDAELIANBAzoACCADIAI3AwAgAUEHdCEBIAAgAyADENEBIgRB//8HTARAIAAgASAEQQ90ckED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QCACIgAoAgAiAiABRw0ACyAAIAEoAgA2AgAgASADKAJgNgIAIAMgATYCYCABIAEtAAVBwAByOgAFCwuDCgEEfwJAAkACQAJAAkACQAJAAkACQAJAAkAgAS0ABEEEaw4jBwQCBgUBAAkJCQkJCQkJCQgJCQkJCQkJCQkJCQkJCQkJCQMJCyAAKAIQIgMoAgQgASgCNCABKAIUQQJ0IgJBACADKAIAEQEAGiADIAMoAgwgAms2AgwgACgCECIDKAIEIAEoAjggASgCHEECdCICQQAgAygCABEBABogAyADKAIMIAJrNgIMIAAoAhAiAygCBCABKAIwIAEoAhBBBHQiAkEAIAMoAgARAQAaIAMgAygCDCACazYCDCAAKAIQIgMoAgQgASgCQCABKAIYIgJBACADKAIAEQEAGiADIAMoAgwgAms2AgwgACgCECIDKAIEIAEoAkQgASgCJEEDdCICQQAgAygCABEBABogAyADKAIMIAJrNgIMIAAoAhAiAygCBCABKAJIIAEoAiBBDGwiAkEAIAMoAgARAQAaIAMgAygCDCACazYCDCAAKAIQIgMoAgQgASgCPCABKAIMQQN0IgJBACADKAIAEQEAGiADIAMoAgwgAms2AgwgACgCECIAKAIEIAFB1ABBACAAKAIAEQEAGiAAIAAoAgxB1ABrNgIMDwsgASgCCCABQRBqRwRAIAEoAhQgASgCECICNgIAIAIEQCACIAEoAhQ2AhQLCyAAKAIQIgAoAgQgAUEgQQAgACgCABEBABogACAAKAIMQSBrNgIMDwsgACgCECICKAIEIAEgAS0ABkECdEEQaiIAQQAgAigCABEBABoMBwsgACgCECICKAIEIAEgAS0ABkEEdEEQaiIAQQAgAigCABEBABoMBgsgASgCFARAIAAoAhAiAygCBCABKAIQQRggAS0AB3QiAkEAIAMoAgARAQAaIAMgAygCDCACazYCDAsgASgCDCEEIAEoAgghAwJAIAEsAAZBAE4NACADaUECSQ0AIANBAXYgA3IiAkECdiACciICQQR2IAJyIgJBCHYgAnIiAkEQdiACckEBaiEDCyAAKAIQIgUoAgQgBCADQQR0IgJBACAFKAIAEQEAGiAFIAUoAgwgAms2AgwgACgCECIAKAIEIAFBIEEAIAAoAgARAQAaIAAgACgCDEEgazYCDA8LIAAgASABKAIcELUCIAEoAhwiBARAIAEgAUE0ajYCFCABQUBrIgIoAgAhACACQQA2AgAgAARAA0AgACgCDCABKAIQIgQoAgQgAEEkQQAgBCgCABEBABogBCAEKAIMQSRrNgIMIAEgAS8BCEEBazsBCCIADQALIAEoAhwhBAsgASgCECICKAIEIAQgASgCGCAEa0HQAGoiAEEAIAIoAgARAQAaIAIgAigCDCAAazYCDAsoAhAiACgCBCABQQRrQfgAQQAgACgCABEBABogACAAKAIMQfgAazYCDA8LIAAoAhAiAigCBCABIAEoAgggAS8BBiIAQQR0QRhqQRAgABtqIgBBACACKAIAEQEAGgwDCyAAKAIQIgUoAhggASgCCCAFKAIgQQFrcUECdGohAwNAIAMiAigCACIEQQxqIQMgASAERw0ACyACIAEoAgw2AgAgBSAFKAIcQQFrNgIcIAAoAhAiAigCBCABIAEtAAdBEWoiAEEAIAIoAgARAQAaDAILIAAoAhAiAigCBCABIAEoAgxBEWoiAEEAIAIoAgARAQAaIAIgAigCDCAAazYCDAsPCyACIAIoAgwgAGs2AgwL1QEBAX8CQCAAKAIQIgItAE4gAUYNACABQQFGBEAgACACEMECGgwBCyACLQBMQRhxIQAgAigCWCIBBEADQCABIAEtAAVBwAFxIAByOgAFIAEoAgAiAQ0ACwsgAkEANgKIASACQgA3A4ABIAIoAmAiAQRAA0AgASABLQAFQcABcSAAcjoABSABKAIAIgENAAsLIAIoAngiAQRAA0AgASABLQAFQcABcSAAcjoABSABKAIAIgENAAsLIAJBADYCmAEgAkIANwOQASACQQg7AE0LIAJBADYCFAtwAQF/AkAgACgCECICLQBNQQhHBEADQCAAEMICGiACLQBNQQhHDQALIAAoAhAiAi0ATUUNAQsDQCAAEMICGiACLQBNDQALCyAAEMMCIAAgARDEAiABQQAgAS0AUCABKAIMIAEoAghqQeQAbmxrENUDC7oKAQl/IAAoAhAiAUEBOgBPAkACQAJAAkACQAJAAkACQAJAAkACQCABLQBNDgkBAgoDBAUGBwAKCyABQgA3AmQgAUEANgJ0IAFCADcCbCABKAKkASIALQAFQRhxBEAgASAAELoCCwJAIAEtADBBwABxRQ0AIAEoAigiAC0ABUEY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xAFxOgAFDAILIAIoAgggAkEQakYNACACIARBxAFxOgAFDAELIAIgA0EkcjoABQsgAiEDCyADKAIAIgINAAsgASgCWCEDCyABQQA2AowBIAEgAzYCiAEgASADNgKEASABIAM2AoABIAEoAmAiAgRAIAAoAhAhBSABQeAAaiEDA0ACQCACLQAFIgRBGHEEQCADIAIoAgA2AgAgACACEL8CDAELIARB+AFxIgNBBHIhBAJAAkACQAJAIAItAARBCGsOAgABAgsgAiAFKAJoNgIoIAUgAjYCaCACIARBxAFxOgAFDAILIAIoAgggAkEQakYNACACIARBxAFxOgAFDAELIAIgA0EkcjoABQsgAiEDCyADKAIAIgINAAsgASgCYCEGCyABIAY2ApgBIAEgBjYClAEgASAGNgKQASABKAJ4IgIEQCABQfgAaiEDIAAoAhAhBQNAAkAgAi0ABSIEQRhxBEAgAyACKAIANgIAIAAgAhC/AgwBCyAEQfgBcSIDQQRyIQQCQAJAAkACQCACLQAEQQhrDgIAAQILIAIgBSgCaDYCKCAFIAI2AmggAiAEQcQBcToABQwCCyACKAIIIAJBEGpGDQAgAiAEQcQBcToABQwBCyACIANBJHI6AAULIAIhAwsgAygCACICDQALCyABQQA2AhQgAUEBOgBOIAEgASgCDCABKAIIajYCECAAIAEQyQILvwQBBn8jAEEQayIEJAAgACgCECICIAIoAngiASgCADYCeCABIAIoAlg2AgAgAiABNgJYIAEgAS0ABSIDQb8BcToABQJAIAItAE1BA2tB/wFxQQNNBEAgASACLQBMQRhxIANBhwFxcjoABQwBCyADQQdxQQNHDQAgAiABNgKMAQsgBCABNgIAIAQgAS0ABEHAAHI6AAgCQCAAIARBAhCjBCIBLQAIQQ9xRQ0AIAAtAAchBSACIAItAFIiBkECcjoAUiAAQQA6AAcgACAAKAIMIgNBEGo2AgwgAyABKQMANwMAIAMgAS0ACDoACCAAIAAoAgwiAUEQajYCDCABIAQpAwA3AwAgASAELQAIOgAIIAAoAhQiASABLwEiQYABcjsBIiAAQcUAQQAgACgCDCAAKAIca0Ega0EAEK8CIAAoAhQiAyADLwEiQf/+A3E7ASIgACAFOgAHIAIgBjoAUkUNAEGWIyECIAAoAgwiAUEIay0A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AGohBAwBCyABQRxqIQQLIAQgACgCaDYCACAAIAE2AmggAkHHAXEMAQsgAkECcws6AAULIAEoAgghAiABKAIUBH9BAiABLQAHdAVBAAsgAmpBAWoPCwALxxEBCH8CQCAAKAIQIgEtAFINACABKAIUIQMCQAJAAkACQCABLQBOQQFHBEAgA0UNBCABLQBNDQEMAgsgA0UNAiABLQBMQRhxIQQgASgCWCICBEADQCACIAItAAVBwAFxIARyOgAFIAIoAgAiAg0ACwsgAUEANgKIASABQgA3A4ABIAEoAmAiAgRAA0AgAiACLQAFQcABcSAEcjoABSACKAIAIgINAAsLIAEoAngiAgRAA0AgAiACLQAFQcABcSAEcjoABSACKAIAIgINAAsLIAFBADYCmAEgAUIANwOQASABQQg7AE0gAUEANgIUCwNAIAAQwgIaIAEtAE0NAAsLIAAQwwIiCCADQQN2IANqSQRAIAAgARDEAiABQQAgAS0AUCABKAIMIAEoAghqQeQAbmxrENUDDwsgASABKAIMIAEoAghqNgIQIAAoAhAiA0EDOgBNAkACQAJAIAMoAlgiAgRAIANB2ABqIQcgAyEGDAELIANBADYCXCADIQIMAQsDQCAHIQRBACEFIAIEQAJAIAItAAUiBSAGLQBMIgZBGHNxBEAgBCACKAIANgIAIAAgAhC/AgwBCyACIAVBwAFxIAZBGHFyOgAFIAIhBAsgBCgCACEFCyAHIARBACAFGyIERgRAIAAoAhAhBiAHKAIAIQIMAQsLIAAoAhAiAi0ATSADIAQ2AlxBCEYNAQsDQCAAEMICGiACLQBNQQhHDQALCyABIAEoAgwgASgCCGpB/////wcgASgCEEHkAG4iACABLQBUQQJ0IgNsIANB/////wcgAG5PG2siAEEfdSAAcRDVAyABIAg2AhQPCyABKAIQIgdB5ABuIQMCQCABKAIMIgJBAEwNACABKAIIIAJqIAEtAFEgA2xBAnQiBCAHak0NACABLQBMQRhxIQMgASgCWCICBEADQCACIAItAAVBwAFxIANyOgAFIAIoAgAiAg0ACwsgAUEANgKIASABQgA3A4ABIAEoAmAiAgRAA0AgAiACLQAFQcABcSADcjoABSACKAIAIgINAAsLIAEoAngiAgRAA0AgAiACLQAFQcABcSADcjoABSACKAIAIgIN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IQIMAQsgACABQQhqIAIgB6ciAEEBa2wgACADbGoiAhCRASEAIAdCAloEQANAIAAgBCABKAKcBPwKAAAgASgCnAQgAGohACABKAKYBCIDBEAgACAFIAP8CgAAIAEoApgEIABqIQALIAdCAlYgB0IBfSEHDQALCyAAIAQgASgCnAT8CgAAIAFBCGogAhCQAUEBIQILIAFBoARqJAAgAguDAQEEfyMAQaAEayIBJAAgAEEBIAFBnARqEIUBIQMgACABQQhqIAEoApwEEJEBIQQCQCABKAKcBCIARQRAQQAhAAwBCwNAIAIgBGogACADaiACQX9zai0AADoAACACQQFqIgIgASgCnAQiAEkNAAsLIAFBCGogABCQASABQaAEaiQAQQELywECAn4EfyMAQRBrIgUkAEEBIQMgAEEBIAVBDGoQhQEhBiAAQQIQiwEhASAFKAIMIgStIQICQCABQgBVBEAgAachAwwBCyABUA0AIAFCACACfVMNACAEIAGnakEBaiEDCwJAAn8gBCACIABBA0J/EI0BIgFTDQAaIAGnIAFCAFkNABpBACABQgAgAn1TDQAaIAQgAadqQQFqCyIEIANPBEAgACADIAZqQQFrIAQgA2tBAWoQPhoMAQsgAEHOxgAQPxoLIAVBEGokAEEBC40BAQR/IwBBoARrIgEkACAAQQEgAUGcBGoQhQEhAyAAIAFBCGogASgCnAQQkQEhBAJAIAEoApwERQRAQQAhAAwBCwNAIAIgBGogAiADai0AACIAQd8AcSAAIABB4QBrQRpJGzoAACACQQFqIgIgASgCnAQiAEkNAAsLIAFBCGogABCQASABQaAEaiQAQQELhBQEDn8DfgF8AX0jAEGwBGsiASQAIABBAUEAEIUBIQcgAUKBgICAEDcCGCABIAA2AhQgASAHNgIQIAAoAgxBADoACCAAIAAoAgxBEGo2AgwgACABQSBqEHIgBy0AAARAQQEhBwNAIAFBFGogDCABQRBqIAFBDGogAUEIahD7AyEFIAEoAggiAiAMaiEGIAEoAgwhBCACQQBKBEADQCABKAIoIgMgASgCJE8EQCABQSBqQQEQdBogASgCKCEDCyABIANBAWo2AiggASgCICADakEAOgAAIAJBAUogAkEBayECDQALCyAEIAZqIQwgByICQQFqIQcCQAJAAkACQAJAAkACQAJA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AX8jAEHQAGsiBCQAAkAgA0GAgAFOBEAgBEEgaiABIAJCAEKAgICAgICA//8AEKIFIAQpAyghAiAEKQMgIQEgA0H//wFJBEAgA0H//wBrIQMMAgsgBEEQaiABIAJCAEKAgICAgICA//8AEKIFQf3/AiADIANB/f8CThtB/v8BayEDIAQpAxghAiAEKQMQIQEMAQsgA0GBgH9KDQAgBEFAayABIAJCAEKAgICAgICAORCiBSAEKQNIIQIgBCkDQCEBIANB9IB+SwRAIANBjf8AaiEDDAELIARBMGogASACQgBCgICAgICAgDkQogVB6IF9IAMgA0HogX1MG0Ga/gFqIQMgBCkDOCECIAQpAzAhAQsgBCABIAJCACADQf//AGqtQjCGEKIFIAAgBCkDCDcDCCAAIAQpAwA3AwAgBEHQAGokAAvJBgIEfwN+IwBBgAFrIgUkAAJAAkACQCADIARCAEIAEJgFRQ0AAn8gBEL///////8/gyEKAn8gBEIwiKdB//8BcSIGQf//AUcEQEEEIAYNARpBAkEDIAMgCoRQGwwCCyADIAqEUAsLIAJCMIinIghB//8BcSIHQf//AUYNAA0BCyAFQRBqIAEgAiADIAQQogUgBSAFKQMQIgIgBSkDGCIBIAIgARCaBSAFKQMIIQIgBSkDACEEDAELIAEgAkL///////////8AgyIKIAMgBEL///////////8AgyIJEJgFQQBMBEAgASAKIAMgCRCYBQRAIAEhBAwCCyAFQfAAaiABIAJCAEIAEKIFIAUpA3ghAiAFKQNwIQQMAQsgBEIwiKdB//8BcSEGIAcEfiABBSAFQeAAaiABIApCAEKAgICAgIDAu8AAEKIFIAUpA2giCkIwiKdB+ABrIQcgBSkDYAshBCAGRQRAIAVB0ABqIAMgCUIAQoCAgICAgMC7wAAQogUgBSkDWCIJQjCIp0H4AGshBiAFKQNQIQMLIAlC////////P4NCgICAgICAwACEIQsgCkL///////8/g0KAgICAgIDAAIQhCiAGIAdIBEADQAJ+IAogC30gAyAEVq19IglCAFkEQCAJIAQgA30iBIRQBEAgBUEgaiABIAJCAEIAEKIFIAUpAyghAiAFKQMgIQQMBQsgCUIBhiAEQj+IhAwBCyAKQgGGIARCP4iECyEKIARCAYYhBCAHQQFrIgcgBkoN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fiMAQfAAayIGJAAgBEL///////////8AgyEJAkACQCABUCIFIAJC////////////AIMiCkKAgICAgIDA//8AfUKAgICAgIDAgIB/VCAKUBtFBEAgA0IAUiAJQoCAgICAgMD//wB9IgtCgICAgICAwICAf1YgC0KAgICAgIDAgIB/URsNAQsgBSAKQoCAgICAgMD//wBUIApCgICAgICAwP//AFEbRQRAIAJCgICAgICAIIQhBCABIQMMAgsgA1AgCUKAgICAgIDA//8AVCAJQoCAgICAgMD//wBRG0UEQCAEQoCAgICAgCCEIQQMAgsgASAKQoCAgICAgMD//wCFhFAEQEKAgICAgIDg//8AIAIgASADhSACIASFQoCAgICAgICAgH+FhFAiBRshBEIAIAEgBRshAwwCCyADIAlCgICAgICAwP//AIWEUA0BIAEgCoRQBEAgAyAJhEIAUg0CIAEgA4MhAyACIASDIQQMAgsgAyAJhEIAUg0AIAEhAyACIQQMAQsgAyABIAEgA1QgCSAKViAJIApRGyIIGyEKIAQgAiAIGyILQv///////z+DIQkgAiAEIAgbIgJCMIinQf//AXEhByALQjCIp0H//wFxIgVFBEAgBkHgAGogCiAJIAogCSAJUCIFG3kgBUEGdK18pyIFQQ9rEJcFIAYpA2ghCSAGKQNgIQpBECAFayEFCyABIAMgCBshAyACQv///////z+DIQQgB0UEQCAGQdAAaiADIAQgAyAEIARQIgcbeSAHQQZ0rXynIgdBD2sQlwVBECAHayEHIAYpA1ghBCAGKQNQIQMLIARCA4YgA0I9iIRCgICAgICAgASEIQEgCUIDhiAKQj2IhCACIAuFIQ0CfiADQgOGIgIgBSAHRg0AGiAFIAdrIgdB/wBLBEBCACEBQgEMAQsgBkFAayACIAFBgAEgB2sQlwUgBkEwaiACIAEgBxChBSAGKQM4IQEgBikDMCAGKQNAIAYpA0iEQgBSrYQLIQlCgICAgICAgASEIQwgCkIDhiEKAkAgDUIAUwRAQgAhA0IAIQQgCSAKhSABIAyFhFANAiAKIAl9IQIgDCABfSAJIApWrX0iBEL/////////A1YNASAGQSBqIAIgBCACIAQgBFAiBxt5IAdBBnStfKdBDGsiBxCXBSAFIAdrIQUgBikDKCEEIAYpAyAhAgwBCyAJIAp8IgIgCVStIAEgDHx8IgRCgICAgICAgAiDUA0AIAlCAYMgBEI/hiACQgGIhIQhAiAFQQFqIQUgBEIBiCEECyALQoCAgICAgICAgH+DIQEgBUH//wFOBEAgAUKAgICAgIDA//8AhCEEQgAhAwwBC0EAIQcCQCAFQQBKBEAgBSEHDAELIAZBEGogAiAEIAVB/wBqEJcFIAYgAiAEQQEgBWsQoQUgBikDACAGKQMQIAYpAxiEQgBSrYQhAiAGKQMIIQQLIAKnQQdxIgVBBEutIARCPYYgAkIDiIQiAnwiAyACVK0gBEIDiEL///////8/gyAHrUIwhoQgAYR8IQQCQCAFQQRGBEAgBCADQgGDIgEgA3wiAyABVK18IQQMAQsgBUUNAQsLIAAgAzcDACAAIAQ3AwggBkHwAGokAAtQAQF+AkAgA0HAAHEEQCABIANBQGqthiECQgAhAQwBCyADRQ0AIAIgA60iBIYgAUHAACADa62IhCECIAEgBIYhAQsgACABNwMAIAAgAjcDCAvbAQIBfwJ+QQEhBAJAIABCAFIgAUL///////////8AgyIFQoCAgICAgMD//wBWIAVCgICAgICAwP//AFEbDQAgAkIAUiADQv///////////wCDIgZCgICAgICAwP//AFYgBkKAgICAgIDA//8AURsNACAAIAKEIAUgBoSEUARAQQAPCyABIAODQgBZBEBBfyEEIAAgAlQgASADUyABIANRGw0BIAAgAoUgASADhYRCAFIPC0F/IQQgACACViABIANVIAEgA1EbDQAgACAChSABIAOFhEIAUiEECyAEC8ABAgF/An5BfyEDAkAgAEIAUiABQv///////////wCDIgRCgICAgICAwP//AFYgBEKAgICAgIDA//8AURsNACACQv///////////wCDIgVCgICAgICAwP//AFYgBUKAgICAgIDA//8AUnENACAAIAQgBYSEUARAQQAPCyABIAKDQgBZBEAgASACUiABIAJTcQ0BIAAgASAChYRCAFIPCyAAQgBSIAEgAlUgASACURsNACAAIAEgAoWEQgBSIQMLIAMLvg8CBX8PfiMAQdACayIFJAAgBEL///////8/gyEKIAJC////////P4MhCyACIASFQoCAgICAgICAgH+DIQwgBEIwiKdB//8BcSEIAkACQCACQjCI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AxgiBFYgASAEURtxrXwiAlatfCIEIAIgBEKAgICAgIDA//8AVCADIAUpAwBWIAEgBSkDCCIDViABIANRG3GtfCIBIAJUrXwgDIQhDAsgACABNwMAIAAgDDcDCCAFQdACaiQACx8AQbCSAigCAEUEQEGwkgIgADYCAEG0kgIgATYCAAsLfgEDf0G4kgJBuJICKAIAQQFqIgU2AgAgACAFNgIAIAMEQANAIAIgBkEDdGoiBCgCAEUEQCAEIAU2AgAgBCABNgIEIARBADYCCCADJAEgAg8LIAZBAWoiBiADRw0ACwsgACABIAIgA0EEdEEIchCVBSADQQF0IgAQnAUgACQBCyEAQbCSAigCAEUEQEGwkgIgADYCAEG0kgIgATYCAAsQGgv6AQIDfgJ/IwBBEGsiBSQAAn4gAb0iBEL///////////8AgyICQoCAgICAgIAIfUL/////////7/8AWARAIAJCPIYhAyACQgSIQoCAgICAgICAPHwMAQsgAkKAgICAgICA+P8AWgRAIARCPIYhAyAEQgSIQoCAgICAgMD//wCEDAELIAJQBEBCAAwBCyAFIAJCACACp2dBIGogAkIgiKdnIAJCgICAgBBUGyIGQTFqEJcFIAUpAwAhAyAFKQMIQoCAgICAgMAAhUGM+AAgBmutQjCGhAshAiAAIAM3AwAgACACIARCgICAgICAgICAf4OENwMIIAVBEGokAAt/AgJ/AX4jAEEQayIDJAAgAAJ+IAFFBEBCAAwBCyADIAEgAUEfdSICcyACayICrUIAIAJnIgJB0QBqEJcFIAMpAwhCgICAgICAwACFQZ6AASACa61CMIZ8IAFBgICAgHhxrUIghoQhBCADKQMACzcDACAAIAQ3AwggA0EQaiQAC2cCAX8BfiMAQRBrIgIkACAAAn4gAUUEQEIADAELIAIgAa1CAEHwACABZyIBQR9zaxCXBSACKQMIQoCAgICAgMAAhUGegAEgAWutQjCGfCEDIAIpAwALNwMAIAAgAzcDCCACQRBqJAALUAEBfgJAIANBwABxBEAgAiADQUBqrYghAUIAIQIMAQsgA0UNACACQcAAIANrrYYgASADrSIEiIQhASACIASIIQILIAAgATcDACAAIAI3AwgLwQoCBX8PfiMAQeAAayIFJAAgBEL///////8/gyEMIAIgBIVCgICAgICAgICAf4MhCiACQv///////z+DIg1CIIghDiAEQjCIp0H//wFxIQcCQAJAIAJCMIinQf//AXEiCUH//wFrQYKAfk8EQCAHQf//AWtBgYB+Sw0BCyABUCACQv///////////wCDIgtCgICAgICAwP//AFQgC0KAgICAgIDA//8AURtFBEAgAkKAgICAgIAghCEKDAILIANQIARC////////////AIMiAkKAgICAgIDA//8AVCACQoCAgICAgMD//wBRG0UEQCAEQoCAgICAgCCEIQogAyEBDAILIAEgC0KAgICAgIDA//8AhYRQBEAgAiADhFAEQEKAgICAgIDg//8AIQpCACEBDAMLIApCgICAgICAwP//AIQhCkIAIQEMAgsgAyACQoCAgICAgMD//wCFhFAEQCABIAuEQgAhAVAEQEKAgICAgIDg//8AIQoMAwsgCkKAgICAgIDA//8AhCEKDAILIAEgC4RQBEBCACEBDAILIAIgA4RQBEBCACEBDAILIAtC////////P1gEQCAFQdAAaiABIA0gASANIA1QIgYbeSAGQQZ0rXynIgZBD2sQlwVBECAGayEGIAUpA1giDUIgiCEOIAUpA1AhAQsgAkL///////8/Vg0AIAVBQGsgAyAMIAMgDCAMUCIIG3kgCEEGdK18pyIIQQ9rEJcFIAYgCGtBEGohBiAFKQNIIQwgBSkDQCEDCyADQg+GIgtCgID+/w+DIgIgAUIgiCIEfiIQIAtCIIgiEyABQv////8PgyIBfnwiD0IghiIRIAEgAn58IgsgEVStIAIgDUL/////D4MiDX4iFSAEIBN+fCIRIAxCD4YiEiADQjGIhEL/////D4MiAyABfnwiFCAPIBBUrUIghiAPQiCIhHwiDyACIA5CgIAEhCIMfiIWIA0gE358Ig4gEkIgiEKAgICACIQiAiABfnwiECADIAR+fCISQiCGfCIXfCEBIAcgCWogBmpB//8AayEGAkAgAiAEfiIYIAwgE358IgQgGFStIAQgBCADIA1+fCIEVq18IAIgDH58IAQgBCARIBVUrSARIBRWrXx8IgRWrXwgAyAMfiIDIAIgDX58IgIgA1StQiCGIAJCIIiEfCAEIAJCIIZ8IgIgBFStfCACIAIgECASVq0gDiAWVK0gDiAQVq18fEIghiASQiCIhHwiAlatfCACIAIgDyAUVK0gDyAXVq18fCICVq18IgRCgICAgICAwACDQgBSBEAgBkEBaiEGDAELIAtCP4ggBEIBhiACQj+IhCEEIAJCAYYgAUI/iIQhAiALQgGGIQsgAUIBhoQhAQsgBkH//wFOBEAgCkKAgICAgIDA//8AhCEKQgAhAQwBCwJ+IAZBAEwEQEEBIAZrIgdB/wBNBEAgBUEwaiALIAEgBkH/AGoiBhCXBSAFQSBqIAIgBCAGEJcFIAVBEGogCyABIAcQoQUgBSACIAQgBxChBSAFKQMwIAUpAziEQgBSrSAFKQMgIAUpAxCEhCELIAUpAyggBSkDGIQhASAFKQMAIQIgBSkDCAwCC0IAIQEMAgsgBEL///////8/gyAGrUIwhoQLIAqEIQogC1AgAUIAWSABQoCAgICAgICAgH9RG0UEQCAKIAJCAXwiAVCtfCEKDAELIAsgAUKAgICAgICAgIB/hYRCAFIEQCACIQEMAQsgCiACIAJCAYN8IgEgAlStfCEKCyAAIAE3AwAgACAKNwMIIAVB4ABqJAALdQEBfiAAIAEgBH4gAiADfnwgA0IgiCICIAFCIIgiBH58IANC/////w+DIgMgAUL/////D4MiAX4iBUIgiCADIAR+fCIDQiCIfCABIAJ+IANC/////w+DfCIBQiCIfDcDCCAAIAVC/////w+DIAFCIIaENwMAC0UBAX8jAEEQayIFJAAgBSABIAIgAyAEQoCAgICAgICAgH+FEJYFIAUpAwAhASAAIAUpAwg3AwggACABNwMAIAVBEGokAAvTAwICfgJ/IwBBIGsiBCQAAkAgAUL///////////8AgyIDQoCAgICAgMCAPH0gA0KAgICAgIDA/8MAfVQEQCABQgSGIABCPIiEIQMgAEL//////////w+DIgBCgYCAgICAgIAIWgRAIANCgYCAgICAgIDAAHwhAgwCCyADQoCAgICAgICAQH0hAiAAQoCAgICAgICACFINASACIANCAYN8IQIMAQsgAFAgA0KAgICAgIDA//8AVCADQoCAgICAgMD//wBRG0UEQCABQgSGIABCPIiEQv////////8Dg0KAgICAgICA/P8AhCECDAELQoCAgICAgID4/wAhAiADQv///////7//wwBWDQBCACECIANCMIinIgVBkfcASQ0AIARBEGogACABQv///////z+DQoCAgICAgMAAhCICIAVBgfcAaxCXBSAEIAAgAkGB+AAgBWsQoQUgBCkDCEIEhiAEKQMAIgBCPIiEIQIgBCkDECAEKQMYhEIAUq0gAEL//////////w+DhCIAQoGAgICAgICACFoEQCACQgF8IQIMAQsgAEKAgICAgICAgAhSDQAgAkIBgyACfCECCyAEQSBqJAAgAiABQoCAgICAgICAgH+DhL8LBAAjAAsGACAAJAALEAAjACAAa0FwcSIAJAAgAAsPAEHAksIAJANBwJICJAILBwAjACMCawsEACMDCwQAIwILC8TkAcQBAEGACAvOPmludGVydmFsIGlzIGVtcHR5AGluZmluaXR5AGdldHJlZ2lzdHJ5AG5vdCBlbm91Z2ggbWVtb3J5AG1vbmV0YXJ5AGJpbmFyeQBhdHRlbXB0IHRvIHlpZWxkIGFjcm9zcyBhIEMtY2FsbCBib3VuZGFyeQB5ZGF5AHdkYXkAYUFiQmNDZERlRmdHaEhJam1NbnByUlN0VHVVVndXeFh5WXpaJXx8RWNFQ0V4RVhFeUVZT2RPZU9IT0lPbU9NT1NPdU9VT1ZPd09XT3kAMHglbGx4AHBhdHRlcm4gdG9vIGNvbXBsZXgAX19uZXdpbmRleABfX2luZGV4AGludGVnZXIgaW5kZXgAaW52YWxpZCB1cHZhbHVlIGluZGV4AG1heAAtKyAgIDBYMHgALTBYKzBYIDBYLTB4KzB4IDB4AF9fcG93AGludGVnZXIgb3ZlcmZsb3cAQyBzdGFjayBvdmVyZmxvdwBzdHJpbmcgbGVuZ3RoIG92ZXJmbG93AHRhYmxlIG92ZXJmbG93AHVuc2lnbmVkIG92ZXJmbG93AGdldGVudgBfX2lkaXYAX19kaXYAZmxuU3J0dQB0ZXh0AG5leHQAX0lPX291dHB1dABfSU9faW5wdXQAc3Rkb3V0AGNvbnN0AG11bHRpcGxlIHRvLWJlLWNsb3NlZCB2YXJpYWJsZXMgaW4gbG9jYWwgbGlzdABpc2RzdABzcXJ0AHNvcnQAZGF0YSBzdHJpbmcgdG9vIHNob3J0AGFzc2VydABpbnNlcnQAcmVzdGFydABfX2Jub3QAY291bnQAU2xudABwcmludABjb2RlcG9pbnQAYWJzZW50AGNvbW1lbnQAY29uc3RhbnQAdWx0AF9fbHQAZXhpdABpbml0AHNldGNzdGFja2xpbWl0AHJhd3NldABvZmZzZXQAcmF3Z2V0AGNvbGxlY3QAc2VsZWN0AGJ0AGZsb2F0AHZhcmlhYmxlLWxlbmd0aCBmb3JtYXQAaW52YWxpZCBmb3JtYXQAbmFtZXdoYXQAcmVwZWF0AF9fY29uY2F0ACp0AHN0YXR1cwB0b28gbWFueSBhcmd1bWVudHMAd3JvbmcgbnVtYmVyIG9mIGFyZ3VtZW50cwBjb25zdGFudHMAdG9vIG1hbnkgcmVzdWx0cwBpcGFpcnMAX19wYWlycwBmdW5jdGlvbiBvciBleHByZXNzaW9uIG5lZWRzIHRvbyBtYW55IHJlZ2lzdGVycwBzcGVjaWZpZXIgJyUlcScgY2Fubm90IGhhdmUgbW9kaWZpZXJzAHNlYXJjaGVycwBudXBzAGxhYmVscy9nb3RvcwBzdHJpbmcgY29udGFpbnMgemVyb3MAYWNvcwB0b28gbWFueSBuZXN0ZWQgZnVuY3Rpb25zAG5wYXJhbXMAdG9vIG1hbnkgdXB2YWx1ZXMAYXR0ZW1wdCB0byBjb21wYXJlIHR3byAlcyB2YWx1ZXMAdG9vIG1hbnkgY2FwdHVyZXMAY29yZSBhbmQgbGlicmFyeSBoYXZlIGluY29tcGF0aWJsZSBudW1lcmljIHR5cGVzAGFjdGl2ZWxpbmVzAGNodW5rIGhhcyB0b28gbWFueSBsaW5lcwBsb2NhbCB2YXJpYWJsZXMAb3Bjb2RlcwBmaW5hbCBwb3NpdGlvbiBvdXQgb2YgYm91bmRzAGluaXRpYWwgcG9zaXRpb24gb3V0IG9mIGJvdW5kcwBhYnMAJXMlcwBhdHRlbXB0IHRvICVzIGEgJXMgdmFsdWUlcwBsdWFvcGVuXyVzAEAlcwA+JXMAbW9kdWxlICclcycgbm90IGZvdW5kOiVzACVzIGV4cGVjdGVkLCBnb3QgJXMAJXMgbmVhciAlcwB0b28gbWFueSAlcyAobGltaXQgaXMgJWQpIGluICVzAGF0dGVtcHQgdG8gY29tcGFyZSAlcyB3aXRoICVzAGNhbm5vdCAlcyAlczogJXMAJXM6JWQ6ICVzAGVycm9yIGxvYWRpbmcgbW9kdWxlICclcycgZnJvbSBmaWxlICclcyc6CgklcwBob3VyAGN1cgBzdGRlcnIAX19ieG9yAGZvciBpdGVyYXRvcgBzeW50YXggZXJyb3IAZmxvb3IAZm9yAF9fYm9yAF9fc2hyAGxvd2VyAGludmFsaWQgbG9uZyBzdHJpbmcgZGVsaW1pdGVyAHVwcGVyAG1heGludGVnZXIAdG9pbnRlZ2VyAG1pbmludGVnZXIAb2JqZWN0IGxlbmd0aCBpcyBub3QgYW4gaW50ZWdlcgBmaWVsZCAnJXMnIGlzIG5vdCBhbiBpbnRlZ2VyAGx1YV9JbnRlZ2VyACVkLWJ5dGUgaW50ZWdlciBkb2VzIG5vdCBmaXQgaW50byBMdWEgSW50ZWdlcgBudHJhbnNmZXIAZnRyYW5zZmVyAHRvbnVtYmVyAG1hbGZvcm1lZCBudW1iZXIAbHVhX051bWJlcgBjaGFyAHllYXIAX19lcQBleHAAc3RvcAAnX19uZXdpbmRleCcgY2hhaW4gdG9vIGxvbmc7IHBvc3NpYmxlIGxvb3AAJ19faW5kZXgnIGNoYWluIHRvbyBsb25nOyBwb3NzaWJsZSBsb29wAGR1bXAAc3RlcAByZXAAd3JhcABQcAAlczogJXAAcHJvdG8AZ290bwAvdXNyL2xvY2FsL2xpYi9sdWEvNS40Lz8uc287L3Vzci9sb2NhbC9saWIvbHVhLzUuNC9sb2FkYWxsLnNvOy4vPy5zbwBhdHRlbXB0IHRvIGRpdmlkZSBieSB6ZXJvACdmb3InIHN0ZXAgaXMgemVybwBubwBpbwBnZXRpbmZvAGRvAHJldHVybgBjaGFycGF0dGVybgBtaXNzaW5nICdbJyBhZnRlciAnJSVmJyBpbiBwYXR0ZXJuAHdhcm4AaW52YWxpZCBvcHRpb24ASW5zdHJ1Y3Rpb24AbWFpbiBmdW5jdGlvbgB1bmFibGUgdG8gZHVtcCBnaXZlbiBmdW5jdGlvbgBjYW5ub3QgdXNlICcuLi4nIG91dHNpZGUgYSB2YXJhcmcgZnVuY3Rpb24AbnVtYmVyJXMgaGFzIG5vIGludGVnZXIgcmVwcmVzZW50YXRpb24AbnVtYmVyIGhhcyBubyBpbnRlZ2VyIHJlcHJlc2VudGF0aW9uAGRhdGUgcmVzdWx0IGNhbm5vdCBiZSByZXByZXNlbnRlZCBpbiB0aGlzIGluc3RhbGxhdGlvbgB0aW1lIHJlc3VsdCBjYW5ub3QgYmUgcmVwcmVzZW50ZWQgaW4gdGhpcyBpbnN0YWxsYXRpb24AZHluYW1pYyBsaWJyYXJpZXMgbm90IGVuYWJsZWQ7IGNoZWNrIHlvdXIgTHVhIGluc3RhbGxhdGlvbgBwZXJmb3JtIGJpdHdpc2Ugb3BlcmF0aW9uIG9uAHBlcmZvcm0gYXJpdGhtZXRpYyBvbgBhc2luAHVwdmFsdWVqb2luAG1pbgA9c3RkaW4AbWFpbgBwb3BlbgByZW9wZW4AcmF3bGVuAF9fbGVuAHRoZW4AYXRhbgBuYW4AYm9vbGVhbgB2YWx1ZSBoYXMgbm8gbGl0ZXJhbCBmb3JtAHJhbmRvbQBfX3VubQBzZXRzdGVwbXVsAF9fbXVsAHVuZXhwZWN0ZWQgc3ltYm9sAGZ1bGwAeHBjYWxsAGlzdGFpbGNhbGwAX19jYWxsAHRhaWwgY2FsbAB1bnRpbAB0YWJsZSBpbmRleCBpcyBuaWwAY2VpbABfX3NobAByYXdlcXVhbABpbmNyZW1lbnRhbABnZW5lcmF0aW9uYWwAbm9ybWFsAHNldGxvY2FsAGdldGxvY2FsAGdsb2JhbABTbABzZXRob29rAGdldGhvb2sAZXh0ZXJuYWwgaG9vawBub3QgYSBiaW5hcnkgY2h1bmsAbWFpbiBjaHVuawBjb3JydXB0ZWQgY2h1bmsAdHJ1bmNhdGVkIGNodW5rAHNlZWsAY2xvY2sAdG9vIG1hbnkgcmVzdWx0cyB0byB1bnBhY2sAdHJhY2ViYWNrAGJyZWFrAHBpAG1vbnRoAHNlYXJjaHBhdGgAY3BhdGgAbWF0aABmbHVzaABmbG9hdCBmb3JtYXQgbWlzbWF0Y2gAaW50ZWdlciBmb3JtYXQgbWlzbWF0Y2gAdmVyc2lvbiBtaXNtYXRjaAAlcyBzaXplIG1pc21hdGNoAGdtYXRjaABkZWJ1ZwBpc3ZhcmFyZwBsb2cAbGV4aWNhbCBlbGVtZW50IHRvbyBsb25nAGNvbnRyb2wgc3RydWN0dXJlIHRvbyBsb25nAHN0cmluZyBzbGljZSB0b28gbG9uZwBpbnZhbGlkIG9yZGVyIGZ1bmN0aW9uIGZvciBzb3J0aW5nAF9fdG9zdHJpbmcAYmluYXJ5IHN0cmluZwBpbnZhbGlkIHVzZSBvZiAnJWMnIGluIHJlcGxhY2VtZW50IHN0cmluZwBiYWQgZm9ybWF0IGZvciBjb25zdGFudCBzdHJpbmcAdGFibGUgb3Igc3RyaW5nAGluaXRpYWwgcG9zaXRpb24gb3V0IG9mIHN0cmluZwB1bmZpbmlzaGVkIHN0cmluZwBlcnJvciBvYmplY3QgaXMgbm90IGEgc3RyaW5nAHJlYWRlciBmdW5jdGlvbiBtdXN0IHJldHVybiBhIHN0cmluZwAnX190b3N0cmluZycgbXVzdCByZXR1cm4gYSBzdHJpbmcAJ3BhY2thZ2UuJXMnIG11c3QgYmUgYSBzdHJpbmcAaXNydW5uaW5nAGVycm9yIGluIGVycm9yIGhhbmRsaW5nAGNvbmZpZwBhcnJheSB0b28gYmlnAG1lbW9yeSBhbGxvY2F0aW9uIGVycm9yOiBibG9jayB0b28gYmlnAGRlZwAlLjE0ZwBzZXR2YnVmAGdldCBsZW5ndGggb2YAaW5mAHNlbGYAZWxzZWlmAG9mZgBtb2RmAHZlcnNpb24gbWlzbWF0Y2g6IGFwcC4gbmVlZHMgJWYsIEx1YSBjb3JlIHByb3ZpZGVzICVmAHBhY2tzaXplAHN0cmluZyBsZW5ndGggZG9lcyBub3QgZml0IGluIGdpdmVuIHNpemUAc3RyaW5nIGxvbmdlciB0aGFuIGdpdmVuIHNpemUAcmVtb3ZlAHRvbyBtYW55IGVsZW1lbnRzIHRvIG1vdmUAdHJ1ZQBzZXR1c2VydmFsdWUAZ2V0dXNlcnZhbHVlAHNldHVwdmFsdWUAZ2V0dXB2YWx1ZQBubyB2YWx1ZQBpbml0aWFsIHZhbHVlAHZhcmlhYmxlICclcycgZ290IGEgbm9uLWNsb3NhYmxlIHZhbHVlAGluaXRpYWwgcG9zaXRpb24gaXMgYSBjb250aW51YXRpb24gYnl0ZQBleGVjdXRlAHdyaXRlAGNvbmNhdGVuYXRlAGNvbGxhdGUAY3JlYXRlAGRhdGUAc2V0cGF1c2UAcmV2ZXJzZQBfX2Nsb3NlAGVsc2UAZmFsc2UAaW52YWxpZCBwYXR0ZXJuIGNhcHR1cmUAdW5maW5pc2hlZCBjYXB0dXJlAHJlcXVpcmUAY3R5cGUAY2Fubm90IGNsb3NlIGEgJXMgY29yb3V0aW5lAGNhbm5vdCByZXN1bWUgbm9uLXN1c3BlbmRlZCBjb3JvdXRpbmUAY2Fubm90IHJlc3VtZSBkZWFkIGNvcm91dGluZQBhdHRlbXB0IHRvIHlpZWxkIGZyb20gb3V0c2lkZSBhIGNvcm91dGluZQBjdXJyZW50bGluZQB0b28gbWFueSBhcmd1bWVudHMgdG8gcmVzdW1lAHRvbyBtYW55IHJlc3VsdHMgdG8gcmVzdW1lAGRpZmZ0aW1lAHRtcG5hbWUAcmVuYW1lAHVuYWJsZSB0byBnZW5lcmF0ZSBhIHVuaXF1ZSBmaWxlbmFtZQBfX25hbWUAd2hpbGUAdG1wZmlsZQBkb2ZpbGUAbG9hZGZpbGUAY2Fubm90IGNsb3NlIHN0YW5kYXJkIGZpbGUAYXR0ZW1wdCB0byB1c2UgYSBjbG9zZWQgZmlsZQBzZXRtZXRhdGFibGUAZ2V0bWV0YXRhYmxlAF9fbWV0YXRhYmxlAGNhbm5vdCBjaGFuZ2UgYSBwcm90ZWN0ZWQgbWV0YXRhYmxlAHN0cmluZy9mdW5jdGlvbi90YWJsZQBuaWwgb3IgdGFibGUAZmllbGQgJyVzJyBtaXNzaW5nIGluIGRhdGUgdGFibGUAJ3BhY2thZ2Uuc2VhcmNoZXJzJyBtdXN0IGJlIGEgdGFibGUAaXN5aWVsZGFibGUAc2V0bG9jYWxlAF9fbGUAaHVnZQBmb3JtYXQgcmVzdWx0IHRvbyBsYXJnZQBidWZmZXIgdG9vIGxhcmdlAHJlc3VsdGluZyBzdHJpbmcgdG9vIGxhcmdlAFVURi04IHZhbHVlIHRvbyBsYXJnZQBkZWNpbWFsIGVzY2FwZSB0b28gbGFyZ2UAbm90IGFuIGludGVnZXIgaW4gcHJvcGVyIHJhbmdlAGluZGV4IG91dCBvZiByYW5nZQBsZXZlbCBvdXQgb2YgcmFuZ2UAdmFsdWUgb3V0IG9mIHJhbmdlAGJhc2Ugb3V0IG9mIHJhbmdlAHBhY2thZ2UAY29sbGVjdGdhcmJhZ2UAX19tb2RlAGludmFsaWQgbW9kZQBpbnZhbGlkIFVURi04IGNvZGUAc291cmNlAGludmFsaWQgZXNjYXBlIHNlcXVlbmNlAEVlAGZtb2QAX19tb2QAbWV0YW1ldGhvZABkZXN0aW5hdGlvbiB3cmFwIGFyb3VuZABmaWVsZCAnJXMnIGlzIG91dC1vZi1ib3VuZABmaW5kAGVuZABfX2JhbmQAJWxsZAB5aWVsZABmaWVsZAB1cHZhbHVlaWQAJ3BvcGVuJyBub3Qgc3VwcG9ydGVkAGhleGFkZWNpbWFsIGRpZ2l0IGV4cGVjdGVkAGZ1bmN0aW9uIGFyZ3VtZW50cyBleHBlY3RlZAAlcyBleHBlY3RlZABMdWEgZnVuY3Rpb24gZXhwZWN0ZWQAdmFsdWUgZXhwZWN0ZWQAJz0nIG9yICdpbicgZXhwZWN0ZWQAPG5hbWU+IG9yICcuLi4nIGV4cGVjdGVkAGZpbGUgaXMgYWxyZWFkeSBjbG9zZWQAZGVmYXVsdCAlcyBmaWxlIGlzIGNsb3NlZABsYXN0bGluZWRlZmluZWQAcmFuZG9tc2VlZABzdXNwZW5kZWQAbG9hZGVkAF9fYWRkAHJhZABwcmVsb2FkAHRocmVhZABkZWFkAFwlMDNkAFwlZABpbnZhbGlkIGNhcHR1cmUgaW5kZXggJSUlZABicmVhayBvdXRzaWRlIGxvb3AgYXQgbGluZSAlZABmdW5jdGlvbiBhdCBsaW5lICVkAG5vIHZpc2libGUgbGFiZWwgJyVzJyBmb3IgPGdvdG8+IGF0IGxpbmUgJWQAbGFiZWwgJyVzJyBhbHJlYWR5IGRlZmluZWQgb24gbGluZSAlZABzaG9ydF9zcmMAZnVuYwBudW1lcmljAF9fZ2MAc2VjACVjAGdzdWIAX19zdWIAcmIAbG9hZGxpYgByd2EAL3Vzci9sb2NhbC9zaGFyZS9sdWEvNS40Lz8ubHVhOy91c3IvbG9jYWwvc2hhcmUvbHVhLzUuNC8/L2luaXQubHVhOy91c3IvbG9jYWwvbGliL2x1YS81LjQvPy5sdWE7L3Vzci9sb2NhbC9saWIvbHVhLzUuNC8/L2luaXQubHVhOy4vPy5sdWE7Li8/L2luaXQubHVhABtMdWEAbGlnaHQgdXNlcmRhdGEAJWEAXwBpbnRlZ3JhbCBzaXplICglZCkgb3V0IG9mIGxpbWl0cyBbMSwlZF0APVtDXQBubyBmaWVsZCBwYWNrYWdlLnByZWxvYWRbJyVzJ10AIl0AX0hPT0tLRVkAeFgAUE9TSVgAX0VOVgBMVUFfTk9FTlYAJVUAR01UAF9DTElCUwBwUAAueFhuTgB0YWJsZSBpbmRleCBpcyBOYU4AX1ZFUlNJT04ATkFOAExDX0FMTAAlSQBMVUFfUEFUSABMVUFfQ1BBVEgAX0cATEFORwBJTkYAZUUAX0xPQURFRABfUFJFTE9BRABDAD0/ADxpbnRlZ2VyPgA8bnVtYmVyPgA8c3RyaW5nPgA8ZW9mPgA8bmFtZT4AZnVuY3Rpb24gPCVzOiVkPgA+PgB+PQA+PQA9PQA8PQA8PAA7OwBzdGFjayB0cmFjZWJhY2s6ADpwcmVsb2FkOgA6OgAtMWU5OTk5AC0wMTIzNDU2Nzg5AHV0ZjgAQy5VVEYtOABfNV80AEx1YSA1LjQAZm9ybWF0IGFza3MgZm9yIGFsaWdubWVudCBub3QgcG93ZXIgb2YgMgAtMAAtIzAALy8AX0cuAC0rIzAgMTIzNDU2Nzg5LgAuLi4AXiQqKz8uKFslLQB3KwAtKwBfVUJPWCoARklMRSoAKHRlbXBvcmFyeSkAKEMgdGVtcG9yYXJ5KQAKCS4uLgkoc2tpcHBpbmcgJWQgbGV2ZWxzKQBzdGFjayBvdmVyZmxvdyAoJXMpACVzOiBiYWQgYmluYXJ5IGZvcm1hdCAoJXMpAGNhbGxpbmcgJyVzJyBvbiBiYWQgc2VsZiAoJXMpAGJhZCBhcmd1bWVudCAjJWQgKCVzKQBiYWQgYXJndW1lbnQgIyVkIHRvICclcycgKCVzKQBjYW5ub3Qgb3BlbiBmaWxlICclcycgKCVzKQBiYWQgJ2ZvcicgJXMgKG51bWJlciBleHBlY3RlZCwgZ290ICVzKQBpbnZhbGlkIHJlcGxhY2VtZW50IHZhbHVlIChhICVzKQBmaWxlICglcCkAKG51bGwpACh2YXJhcmcpAGludmFsaWQgZm9ybWF0ICh0b28gbG9uZykAKGZvciBzdGF0ZSkAKG5vIG5hbWUpAD0oZGVidWcgY29tbWFuZCkAZmlsZSAoY2xvc2VkKQA9KGxvYWQpAHRvbyBtYW55ICVzIChsaW1pdCBpcyAlZCkAJXMgZXhwZWN0ZWQgKHRvIGNsb3NlICVzIGF0IGxpbmUgJWQpAHVuZmluaXNoZWQgbG9uZyAlcyAoc3RhcnRpbmcgYXQgbGluZSAlZCkAKDAvMCkACgkoLi4udGFpbCBjYWxscy4uLikAYXR0ZW1wdCB0byBsb2FkIGEgJXMgY2h1bmsgKG1vZGUgaXMgJyVzJykAICglcyAnJXMnKQBtYWxmb3JtZWQgcGF0dGVybiAobWlzc2luZyBhcmd1bWVudHMgdG8gJyUlYicpAG1hbGZvcm1lZCBwYXR0ZXJuIChtaXNzaW5nICddJykAbWFsZm9ybWVkIHBhdHRlcm4gKGVuZHMgd2l0aCAnJSUnKQAgKABtaXNzaW5nICd9JwBtaXNzaW5nICd7JwB1bmZpbmlzaGVkIHN0cmluZyBmb3IgZm9ybWF0ICd6JwBpbnZhbGlkIGtleSB0byAnbmV4dCcAd3JvbmcgbnVtYmVyIG9mIGFyZ3VtZW50cyB0byAnaW5zZXJ0JwBpbnZhbGlkIGNvbnZlcnNpb24gJyVzJyB0byAnZm9ybWF0JwBpbnZhbGlkIHZhbHVlICglcykgYXQgaW5kZXggJUkgaW4gdGFibGUgZm9yICdjb25jYXQnACVzICclcycAaW52YWxpZCBvcHRpb24gJyVzJwBmdW5jdGlvbiAnJXMnADxnb3RvICVzPiBhdCBsaW5lICVkIGp1bXBzIGludG8gdGhlIHNjb3BlIG9mIGxvY2FsICclcycAdW5rbm93biBhdHRyaWJ1dGUgJyVzJwBubyBtb2R1bGUgJyVzJyBpbiBmaWxlICclcycAYXR0ZW1wdCB0byBhc3NpZ24gdG8gY29uc3QgdmFyaWFibGUgJyVzJwBhdHRlbXB0IHRvICVzIGEgJyVzJyB3aXRoIGEgJyVzJwBpbnZhbGlkIGNvbnZlcnNpb24gc3BlY2lmaWNhdGlvbjogJyVzJwBpbnZhbGlkIGNvbnZlcnNpb24gc3BlY2lmaWVyICclJSVzJwBpbnZhbGlkIG9wdGlvbiAnJSUlYycgdG8gJ2x1YV9wdXNoZnN0cmluZycAbWlzc2luZyBzaXplIGZvciBmb3JtYXQgb3B0aW9uICdjJwBpbnZhbGlkIGZvcm1hdCBvcHRpb24gJyVjJwBpbnZhbGlkIG5leHQgb3B0aW9uIGZvciBvcHRpb24gJ1gnACc8XCVkPicAaW52YWxpZCBvcHRpb24gJz4nAGF0dGVtcHQgdG8gcGVyZm9ybSAnbiUlMCcAJwoJbm8gZmlsZSAnAFtzdHJpbmcgIgBhc3NlcnRpb24gZmFpbGVkIQBlcnJvciBpbiAACgkl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dGVkIHN5c3RlbSBjYWxsAFJlc291cmNlIHRlbXBvcmFyaWx5IHVuYXZhaWxhYmxlAEludmFsaWQgc2VlawBDcm9zcy1kZXZpY2UgbGluawBSZWFkLW9ubHkgZmlsZSBzeXN0ZW0ARGlyZWN0b3J5IG5vdCBlbXB0eQBDb25uZWN0aW9uIHJlc2V0IGJ5IHBlZXIAT3BlcmF0aW9uIHRpbWVkIG91dABDb25uZWN0aW9uIHJlZnVzZWQASG9zdCBpcyBkb3duAEhvc3QgaXMgdW5yZWFjaGFibGUAQWRkcmVzcyBpbiB1c2UAQnJva2VuIHBpcGUASS9PIGVycm9yAE5vIHN1Y2ggZGV2aWNlIG9yIGFkZHJlc3MAQmxvY2sgZGV2aWNlIHJlcXVpcmVkAE5vIHN1Y2ggZGV2aWNlAE5vdCBhIGRpcmVjdG9yeQBJcyBhIGRpcmVjdG9yeQBUZXh0IGZpbGUgYnVzeQBFeGVjIGZvcm1hdCBlcnJvcgBJbnZhbGlkIGFyZ3VtZW50AEFyZ3VtZW50IGxpc3QgdG9vIGxvbmcAU3ltYm9saWMgbGluayBsb29wAEZpbGVuYW1lIHRvbyBsb25nAFRvbyBtYW55IG9wZW4gZmlsZXMgaW4gc3lzdGVtAE5vIGZpbGUgZGVzY3JpcHRvcnMgYXZhaWxhYmxlAEJhZCBmaWxlIGRlc2NyaXB0b3IATm8gY2hpbGQgcHJvY2VzcwBCYWQgYWRkcmVzcwBGaWxlIHRvbyBsYXJnZQBUb28gbWFueSBsaW5rcwBObyBsb2NrcyBhdmFpbGFibGUAUmVzb3VyY2UgZGVhZGxvY2sgd291bGQgb2NjdXIAU3RhdGUgbm90IHJlY292ZXJhYmxlAFByZXZpb3VzIG93bmVyIGRpZWQAT3BlcmF0aW9uIGNhbmNlbGVkAEZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZABObyBtZXNzYWdlIG9mIGRlc2lyZWQgdHlwZQBJZGVudGlmaWVyIHJlbW92ZWQARGV2aWNlIG5vdCBhIHN0cmVhbQBObyBkYXRhIGF2YWlsYWJsZQBEZXZpY2UgdGltZW91dABPdXQgb2Ygc3RyZWFtcyByZXNvdXJjZXMATGluayBoYXMgYmVlbiBzZXZlcmVkAFByb3RvY29sIGVycm9yAEJhZCBtZXNzYWdlAEZpbGUgZGVzY3JpcHRvciBpbiBiYWQgc3RhdGUATm90IGEgc29ja2V0AERlc3RpbmF0aW9uIGFkZHJlc3MgcmVxdWlyZWQATWVzc2FnZSB0b28gbGFyZ2UAUHJvdG9jb2wgd3JvbmcgdHlwZSBmb3Igc29ja2V0AFByb3RvY29sIG5vdCBhdmFpbGFibGUAUHJvdG9jb2wgbm90IHN1cHBvcnRlZABTb2NrZXQgdHlwZSBub3Qgc3VwcG9ydGVkAE5vdCBzdXBwb3J0ZWQAUHJvdG9jb2wgZmFtaWx5IG5vdCBzdXBwb3J0ZWQAQWRkcmVzcyBmYW1pbHkgbm90IHN1cHBvcnRlZCBieSBwcm90b2NvbABBZGRyZXNzIG5vdCBhdmFpbGFibGUATmV0d29yayBpcyBkb3duAE5ldHdvcmsgdW5yZWFjaGFibGUAQ29ubmVjdGlvbiByZXNldCBieSBuZXR3b3JrAENvbm5lY3Rpb24gYWJvcnRlZABObyBidWZmZXIgc3BhY2UgYXZhaWxhYmxlAFNvY2tldCBpcyBjb25uZWN0ZWQAU29ja2V0IG5vdCBjb25uZWN0ZWQAQ2Fubm90IHNlbmQgYWZ0ZXIgc29ja2V0IHNodXRkb3duAE9wZXJhdGlvbiBhbHJlYWR5IGluIHByb2dyZXNzAE9wZXJhdGlvbiBpbiBwcm9ncmVzcwBTdGFsZSBmaWxlIGhhbmRsZQBSZW1vdGUgSS9PIGVycm9yAFF1b3RhIGV4Y2VlZGVkAE5vIG1lZGl1bSBmb3VuZABXcm9uZyBtZWRpdW0gdHlwZQBNdWx0aWhvcCBhdHRlbXB0ZWQAUmVxdWlyZWQga2V5IG5vdCBhdmFpbGFibGUAS2V5IGhhcyBleHBpcmVkAEtleSBoYXMgYmVlbiByZXZva2VkAEtleSB3YXMgcmVqZWN0ZWQgYnkgc2VydmljZQAAAAAApQJbAPABtQWMBSUBgwYdA5QE/wDHAzEDCwa8AY8BfwPKBCsA2gavAEIDTgPcAQ4EFQChBg0BlAILAjgGZAK8Av8CXQPnBAsHzwLLBe8F2wXhAh4GRQKFAIICbANvBPEA8wMYBdkA2gNMBlQCewGdA70EAABRABUCuwCzA20A/wGFBC8F+QQ4AGUBRgGfALcGqAFzAlMBAEH47AELDCEEAAAAAAAAAAAvAgBBmO0BCwY1BEcEVgQAQa7tAQsCoAQAQcLtAQsiRgVgBW4FYQYAAM8BAAAAAAAAAADJBukG+QYeBzkHSQdeBwBB8O0BC5EB0XSeAFedvSqAcFIP//8+JwoAAABkAAAA6AMAABAnAACghgEAQEIPAICWmAAA4fUFGAAAADUAAABxAAAAa////877//+Sv///AAAAAAAAAAAZAAoAGRkZAAAAAAUAAAAAAAAJAAAAAAsAAAAAAAAAABkAEQoZGRkDCgcAAQAJCxgAAAkGCwAACwAGGQAAABkZGQBBke8BCyEOAAAAAAAAAAAZAAoNGRkZAA0AAAIACQ4AAAAJAA4AAA4AQcvvAQsBDABB1+8BCxUTAAAAABMAAAAACQwAAAAAAAwAAAwAQYXwAQsBEABBkfABCxUPAAAABA8AAAAACRAAAAAAABAAABAAQb/wAQsBEgBBy/ABCx4RAAAAABEAAAAACRIAAAAAABIAABIAABoAAAAaGhoAQYLxAQsOGgAAABoaGgAAAAAAAAkAQbPxAQsBFABBv/EBCxUXAAAAABcAAAAACRQAAAAAABQAABQAQe3xAQsBFgBB+fEBCycVAAAAABUAAAAACRYAAAAAABYAABYAADAxMjM0NTY3ODlBQkNERUYAQaDyAQsBBQBBrPIBCwHAAEHE8gELCr4AAAC9AAAAyHwAQdzyAQsBAgBB7PIBCwj//////////wBBsPMBCwkgeQAAAAAAAAkAQcTzAQsBwABB2PMBCxK/AAAAAAAAAL0AAADYfAAAAAQAQYT0AQsE/////wBByPQBCwEFAEHU9AELAcEAQez0AQsOvgAAAMIAAADogAAAAAQAQYT1AQsBAQBBlPUBCwX/////CgBB2PUBCwdIegAAQIkQ";

// src/interpreter/lua-json.lua
var lua_json_default = `--\r
-- json.lua\r
--\r
-- Copyright (c) 2020 rxi\r
--\r
-- Permission is hereby granted, free of charge, to any person obtaining a copy of\r
-- this software and associated documentation files (the "Software"), to deal in\r
-- the Software without restriction, including without limitation the rights to\r
-- use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies\r
-- of the Software, and to permit persons to whom the Software is furnished to do\r
-- so, subject to the following conditions:\r
--\r
-- The above copyright notice and this permission notice shall be included in all\r
-- copies or substantial portions of the Software.\r
--\r
-- THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\r
-- IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\r
-- FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\r
-- AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\r
-- LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\r
-- OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\r
-- SOFTWARE.\r
--\r
\r
local json = { _version = "0.1.2" }\r
\r
-------------------------------------------------------------------------------\r
-- Encode\r
-------------------------------------------------------------------------------\r
\r
local encode\r
\r
local escape_char_map = {\r
  [ "\\\\" ] = "\\\\",\r
  [ "\\"" ] = "\\"",\r
  [ "\\b" ] = "b",\r
  [ "\\f" ] = "f",\r
  [ "\\n" ] = "n",\r
  [ "\\r" ] = "r",\r
  [ "\\t" ] = "t",\r
}\r
\r
local escape_char_map_inv = { [ "/" ] = "/" }\r
for k, v in pairs(escape_char_map) do\r
  escape_char_map_inv[v] = k\r
end\r
\r
\r
local function escape_char(c)\r
  return "\\\\" .. (escape_char_map[c] or string.format("u%04x", c:byte()))\r
end\r
\r
\r
local function encode_nil(val)\r
  return "null"\r
end\r
\r
\r
local function encode_table(val, stack)\r
  local res = {}\r
  stack = stack or {}\r
\r
  -- Circular reference?\r
  if stack[val] then error("circular reference") end\r
\r
  stack[val] = true\r
\r
  if rawget(val, 1) ~= nil or next(val) == nil then\r
    -- Treat as array -- check keys are valid and it is not sparse\r
    local n = 0\r
    for k in pairs(val) do\r
      if type(k) ~= "number" then\r
        error("invalid table: mixed or invalid key types")\r
      end\r
      n = n + 1\r
    end\r
    if n ~= #val then\r
      error("invalid table: sparse array")\r
    end\r
    -- Encode\r
    for i, v in ipairs(val) do\r
      table.insert(res, encode(v, stack))\r
    end\r
    stack[val] = nil\r
    return "[" .. table.concat(res, ",") .. "]"\r
\r
  else\r
    -- Treat as an object\r
    for k, v in pairs(val) do\r
      if type(k) ~= "string" then\r
        error("invalid table: mixed or invalid key types")\r
      end\r
      table.insert(res, encode(k, stack) .. ":" .. encode(v, stack))\r
    end\r
    stack[val] = nil\r
    return "{" .. table.concat(res, ",") .. "}"\r
  end\r
end\r
\r
\r
local function encode_string(val)\r
  return '"' .. val:gsub('[%z\\1-\\31\\\\"]', escape_char) .. '"'\r
end\r
\r
\r
local function encode_number(val)\r
  -- Check for NaN, -inf and inf\r
  if val ~= val or val <= -math.huge or val >= math.huge then\r
    error("unexpected number value '" .. tostring(val) .. "'")\r
  end\r
  return string.format("%.14g", val)\r
end\r
\r
\r
local type_func_map = {\r
  [ "nil"     ] = encode_nil,\r
  [ "table"   ] = encode_table,\r
  [ "string"  ] = encode_string,\r
  [ "number"  ] = encode_number,\r
  [ "boolean" ] = tostring,\r
}\r
\r
\r
encode = function(val, stack)\r
  local t = type(val)\r
  local f = type_func_map[t]\r
  if f then\r
    return f(val, stack)\r
  end\r
  error("unexpected type '" .. t .. "'")\r
end\r
\r
\r
function json.encode(val)\r
  return ( encode(val) )\r
end\r
\r
\r
-------------------------------------------------------------------------------\r
-- Decode\r
-------------------------------------------------------------------------------\r
\r
local parse\r
\r
local function create_set(...)\r
  local res = {}\r
  for i = 1, select("#", ...) do\r
    res[ select(i, ...) ] = true\r
  end\r
  return res\r
end\r
\r
local space_chars   = create_set(" ", "\\t", "\\r", "\\n")\r
local delim_chars   = create_set(" ", "\\t", "\\r", "\\n", "]", "}", ",")\r
local escape_chars  = create_set("\\\\", "/", '"', "b", "f", "n", "r", "t", "u")\r
local literals      = create_set("true", "false", "null")\r
\r
local literal_map = {\r
  [ "true"  ] = true,\r
  [ "false" ] = false,\r
  [ "null"  ] = nil,\r
}\r
\r
\r
local function next_char(str, idx, set, negate)\r
  for i = idx, #str do\r
    if set[str:sub(i, i)] ~= negate then\r
      return i\r
    end\r
  end\r
  return #str + 1\r
end\r
\r
\r
local function decode_error(str, idx, msg)\r
  local line_count = 1\r
  local col_count = 1\r
  for i = 1, idx - 1 do\r
    col_count = col_count + 1\r
    if str:sub(i, i) == "\\n" then\r
      line_count = line_count + 1\r
      col_count = 1\r
    end\r
  end\r
  error( string.format("%s at line %d col %d", msg, line_count, col_count) )\r
end\r
\r
\r
local function codepoint_to_utf8(n)\r
  -- http://scripts.sil.org/cms/scripts/page.php?site_id=nrsi&id=iws-appendixa\r
  local f = math.floor\r
  if n <= 0x7f then\r
    return string.char(n)\r
  elseif n <= 0x7ff then\r
    return string.char(f(n / 64) + 192, n % 64 + 128)\r
  elseif n <= 0xffff then\r
    return string.char(f(n / 4096) + 224, f(n % 4096 / 64) + 128, n % 64 + 128)\r
  elseif n <= 0x10ffff then\r
    return string.char(f(n / 262144) + 240, f(n % 262144 / 4096) + 128,\r
                       f(n % 4096 / 64) + 128, n % 64 + 128)\r
  end\r
  error( string.format("invalid unicode codepoint '%x'", n) )\r
end\r
\r
\r
local function parse_unicode_escape(s)\r
  local n1 = tonumber( s:sub(1, 4),  16 )\r
  local n2 = tonumber( s:sub(7, 10), 16 )\r
   -- Surrogate pair?\r
  if n2 then\r
    return codepoint_to_utf8((n1 - 0xd800) * 0x400 + (n2 - 0xdc00) + 0x10000)\r
  else\r
    return codepoint_to_utf8(n1)\r
  end\r
end\r
\r
\r
local function parse_string(str, i)\r
  local res = ""\r
  local j = i + 1\r
  local k = j\r
\r
  while j <= #str do\r
    local x = str:byte(j)\r
\r
    if x < 32 then\r
      decode_error(str, j, "control character in string")\r
\r
    elseif x == 92 then -- \`\\\`: Escape\r
      res = res .. str:sub(k, j - 1)\r
      j = j + 1\r
      local c = str:sub(j, j)\r
      if c == "u" then\r
        local hex = str:match("^[dD][89aAbB]%x%x\\\\u%x%x%x%x", j + 1)\r
                 or str:match("^%x%x%x%x", j + 1)\r
                 or decode_error(str, j - 1, "invalid unicode escape in string")\r
        res = res .. parse_unicode_escape(hex)\r
        j = j + #hex\r
      else\r
        if not escape_chars[c] then\r
          decode_error(str, j - 1, "invalid escape char '" .. c .. "' in string")\r
        end\r
        res = res .. escape_char_map_inv[c]\r
      end\r
      k = j + 1\r
\r
    elseif x == 34 then -- \`"\`: End of string\r
      res = res .. str:sub(k, j - 1)\r
      return res, j + 1\r
    end\r
\r
    j = j + 1\r
  end\r
\r
  decode_error(str, i, "expected closing quote for string")\r
end\r
\r
\r
local function parse_number(str, i)\r
  local x = next_char(str, i, delim_chars)\r
  local s = str:sub(i, x - 1)\r
  local n = tonumber(s)\r
  if not n then\r
    decode_error(str, i, "invalid number '" .. s .. "'")\r
  end\r
  return n, x\r
end\r
\r
\r
local function parse_literal(str, i)\r
  local x = next_char(str, i, delim_chars)\r
  local word = str:sub(i, x - 1)\r
  if not literals[word] then\r
    decode_error(str, i, "invalid literal '" .. word .. "'")\r
  end\r
  return literal_map[word], x\r
end\r
\r
\r
local function parse_array(str, i)\r
  local res = {}\r
  local n = 1\r
  i = i + 1\r
  while 1 do\r
    local x\r
    i = next_char(str, i, space_chars, true)\r
    -- Empty / end of array?\r
    if str:sub(i, i) == "]" then\r
      i = i + 1\r
      break\r
    end\r
    -- Read token\r
    x, i = parse(str, i)\r
    res[n] = x\r
    n = n + 1\r
    -- Next token\r
    i = next_char(str, i, space_chars, true)\r
    local chr = str:sub(i, i)\r
    i = i + 1\r
    if chr == "]" then break end\r
    if chr ~= "," then decode_error(str, i, "expected ']' or ','") end\r
  end\r
  return res, i\r
end\r
\r
\r
local function parse_object(str, i)\r
  local res = {}\r
  i = i + 1\r
  while 1 do\r
    local key, val\r
    i = next_char(str, i, space_chars, true)\r
    -- Empty / end of object?\r
    if str:sub(i, i) == "}" then\r
      i = i + 1\r
      break\r
    end\r
    -- Read key\r
    if str:sub(i, i) ~= '"' then\r
      decode_error(str, i, "expected string for key")\r
    end\r
    key, i = parse(str, i)\r
    -- Read ':' delimiter\r
    i = next_char(str, i, space_chars, true)\r
    if str:sub(i, i) ~= ":" then\r
      decode_error(str, i, "expected ':' after key")\r
    end\r
    i = next_char(str, i + 1, space_chars, true)\r
    -- Read value\r
    val, i = parse(str, i)\r
    -- Set\r
    res[key] = val\r
    -- Next token\r
    i = next_char(str, i, space_chars, true)\r
    local chr = str:sub(i, i)\r
    i = i + 1\r
    if chr == "}" then break end\r
    if chr ~= "," then decode_error(str, i, "expected '}' or ','") end\r
  end\r
  return res, i\r
end\r
\r
\r
local char_func_map = {\r
  [ '"' ] = parse_string,\r
  [ "0" ] = parse_number,\r
  [ "1" ] = parse_number,\r
  [ "2" ] = parse_number,\r
  [ "3" ] = parse_number,\r
  [ "4" ] = parse_number,\r
  [ "5" ] = parse_number,\r
  [ "6" ] = parse_number,\r
  [ "7" ] = parse_number,\r
  [ "8" ] = parse_number,\r
  [ "9" ] = parse_number,\r
  [ "-" ] = parse_number,\r
  [ "t" ] = parse_literal,\r
  [ "f" ] = parse_literal,\r
  [ "n" ] = parse_literal,\r
  [ "[" ] = parse_array,\r
  [ "{" ] = parse_object,\r
}\r
\r
\r
parse = function(str, idx)\r
  local chr = str:sub(idx, idx)\r
  local f = char_func_map[chr]\r
  if f then\r
    return f(str, idx)\r
  end\r
  decode_error(str, idx, "unexpected character '" .. chr .. "'")\r
end\r
\r
\r
function json.decode(str)\r
  if type(str) ~= "string" then\r
    error("expected argument of type string, got " .. type(str))\r
  end\r
  local res, idx = parse(str, next_char(str, 1, space_chars, true))\r
  idx = next_char(str, idx, space_chars, true)\r
  if idx <= #str then\r
    decode_error(str, idx, "trailing garbage")\r
  end\r
  return res\r
end\r
\r
\r
return json`;

// src/interpreter/lua-wasmoon.ts
var PRELUDE = `
json = require 'json'

function getChat(id, index)
  return json.decode(getChatMain(id, index))
end

function getFullChat(id)
  return json.decode(getFullChatMain(id))
end

function setFullChat(id, value)
  setFullChatMain(id, json.encode(value))
end

function log(value)
  logMain(json.encode(value))
end

function getLoreBooks(id, search)
  return json.decode(getLoreBooksMain(id, search))
end

function loadLoreBooks(id)
  return json.decode(loadLoreBooksMain(id):await())
end

function LLM(id, prompt, useMultimodal, options)
  useMultimodal = useMultimodal or false
  options = options or {}
  return json.decode(LLMMain(id, json.encode(prompt), useMultimodal, json.encode(options)):await())
end

function axLLM(id, prompt, useMultimodal, options)
  useMultimodal = useMultimodal or false
  options = options or {}
  return json.decode(axLLMMain(id, json.encode(prompt), useMultimodal, json.encode(options)):await())
end

function getCharacterImage(id)
  return getCharacterImageMain(id):await()
end

function getPersonaImage(id)
  return getPersonaImageMain(id):await()
end

function cbs(value)
  return cbsMain(value):await()
end

function getName(id)
  return getNameMain(id):await()
end

function setName(id, value)
  return setNameMain(id, value):await()
end

function getDescription(id)
  return getDescriptionMain(id):await()
end

function setDescription(id, value)
  return setDescriptionMain(id, value):await()
end

function getPersonaDescription(id)
  return getPersonaDescriptionMain(id):await()
end

function getAuthorsNote(id)
  return getAuthorsNoteMain(id):await()
end

function getCharacterFirstMessage(id)
  return getCharacterFirstMessageMain(id):await()
end

function setCharacterFirstMessage(id, value)
  return setCharacterFirstMessageMain(id, value):await()
end

local editRequestFuncs = {}
local editDisplayFuncs = {}
local editInputFuncs = {}
local editOutputFuncs = {}

function listenEdit(type, func)
  if type == 'editRequest' then editRequestFuncs[#editRequestFuncs + 1] = func return end
  if type == 'editDisplay' then editDisplayFuncs[#editDisplayFuncs + 1] = func return end
  if type == 'editInput' then editInputFuncs[#editInputFuncs + 1] = func return end
  if type == 'editOutput' then editOutputFuncs[#editOutputFuncs + 1] = func return end
  error('Invalid type')
end

function getState(id, name)
  local escapedName = '__' .. name
  local raw = getChatVar(id, escapedName)
  if raw == nil or raw == '' or raw == 'null' then return nil end
  local ok, v = pcall(json.decode, raw)
  if ok then return v end
  return nil
end

function setState(id, name, value)
  local escapedName = '__' .. name
  setChatVar(id, escapedName, json.encode(value))
end

function async(callback)
  return function(...)
    local co = coroutine.create(callback)
    local safe, result = coroutine.resume(co, ...)
    return Promise.create(function(resolve, reject)
      local checkresult
      local step = function()
        if coroutine.status(co) == "dead" then
          local send = safe and resolve or reject
          return send(result)
        end
        safe, result = coroutine.resume(co)
        checkresult()
      end
      checkresult = function()
        if safe and result == Promise.resolve(result) then
          result:finally(step)
        else
          step()
        end
      end
      checkresult()
    end)
  end
end

callListenMain = async(function(type, id, value, meta)
  local realValue = json.decode(value)
  local realMeta = json.decode(meta)
  if type == 'editRequest' then for _, f in ipairs(editRequestFuncs) do realValue = f(id, realValue, realMeta) end
  elseif type == 'editDisplay' then for _, f in ipairs(editDisplayFuncs) do realValue = f(id, realValue, realMeta) end
  elseif type == 'editInput' then for _, f in ipairs(editInputFuncs) do realValue = f(id, realValue, realMeta) end
  elseif type == 'editOutput' then for _, f in ipairs(editOutputFuncs) do realValue = f(id, realValue, realMeta) end
  end
  return json.encode(realValue)
end)
`;
var factoryPromise = null;
var engines = new Map;
async function ensureFactory() {
  if (factoryPromise)
    return factoryPromise;
  factoryPromise = (async () => {
    const [mod, glue] = await Promise.all([
      Promise.resolve().then(() => __toESM(require_dist(), 1)),
      Promise.resolve().then(() => exports__glue_wasm_b64)
    ]);
    const factory = new mod.LuaFactory(glue.GLUE_WASM_DATA_URI);
    await factory.mountFile("json.lua", lua_json_default);
    return factory;
  })();
  return factoryPromise;
}
function getEngineEntry(key) {
  const existing = engines.get(key);
  if (existing)
    return existing;
  const created = (async () => {
    const factory = await ensureFactory();
    const engine = await factory.createEngine({ injectObjects: true });
    return { engine, code: null, tail: Promise.resolve(), current: {}, bound: new Set };
  })();
  engines.set(key, created);
  return created;
}
function clearWasmoonEngine(key) {
  engines.delete(key);
}
async function executeWasmoon(code, globals, opts) {
  const entry = await getEngineEntry(opts.wasmoonKey);
  const run = entry.tail.then(async () => {
    if (entry.code !== null && entry.code !== code) {
      entry.engine.global.close?.();
      const factory = await ensureFactory();
      entry.engine = await factory.createEngine({ injectObjects: true });
      entry.code = null;
      entry.bound.clear();
    }
    const engine = entry.engine;
    entry.current = globals;
    for (const name of Object.keys(globals)) {
      if (typeof globals[name] !== "function" || entry.bound.has(name))
        continue;
      engine.global.set(name, (...args) => entry.current[name](...args));
      entry.bound.add(name);
    }
    if (entry.code === null) {
      await engine.doString(PRELUDE + `
` + code);
      entry.code = code;
    }
    const fn = engine.global.get(String(opts.entry ?? "callListenMain"));
    if (typeof fn === "function") {
      return await fn(...opts.args ?? []);
    }
    return;
  });
  entry.tail = run.catch(() => {
    return;
  });
  return run;
}

// local/tests/browser/wasmoon-lifecycle-harness.ts
var mode = "editDisplay-browser-test";
var sourceA = `
  counter = counter or 0
  function lifecycle()
    counter = counter + 1
    return "A" .. counter
  end
`;
var sourceB = `
  function lifecycle()
    return "B|" .. tostring(counter or "clean")
  end
`;
async function run(source) {
  return executeWasmoon(source, {}, {
    wasmoonKey: mode,
    entry: "lifecycle"
  });
}
async function main() {
  clearWasmoonEngine(mode);
  const lifecycleActual = [
    await run(sourceA),
    await run(sourceA),
    await run(sourceB),
    await run(sourceA)
  ];
  const lifecycleExpected = ["A1", "A2", "B|clean", "A1"];
  let updatedDescription = "";
  let updatedName = "";
  let updatedFirstMessage = "";
  const characterActualJson = await executeWasmoon(`
    listenEdit("editDisplay", function()
      local name = getName("trigger")
      local description = getDescription("trigger")
      local firstMessage = getCharacterFirstMessage("trigger")
      setName("trigger", "renamed")
      setDescription("trigger", "updated")
      setCharacterFirstMessage("trigger", "new greeting")
      local persona = getPersonaDescription("trigger")
      local note = getAuthorsNote("trigger")
      return name .. "|" .. description .. "|" .. firstMessage .. "|" .. persona .. "|" .. note
    end)
  `, {
    getNameMain: async () => "name",
    setNameMain: async (_id, value) => {
      updatedName = String(value);
    },
    getDescriptionMain: async () => "description",
    setDescriptionMain: async (_id, value) => {
      updatedDescription = String(value);
    },
    getPersonaDescriptionMain: async () => "persona",
    getAuthorsNoteMain: async () => "note",
    getCharacterFirstMessageMain: async () => "greeting",
    setCharacterFirstMessageMain: async (_id, value) => {
      updatedFirstMessage = String(value);
    }
  }, {
    wasmoonKey: "character-api-browser-test",
    entry: "callListenMain",
    args: ["editDisplay", "trigger", JSON.stringify("input"), JSON.stringify({})]
  });
  const characterActual = JSON.parse(String(characterActualJson));
  const actual = {
    lifecycleActual,
    characterActual,
    updatedName,
    updatedDescription,
    updatedFirstMessage
  };
  const expected = {
    lifecycleActual: lifecycleExpected,
    characterActual: "name|description|greeting|persona|note",
    updatedName: "renamed",
    updatedDescription: "updated",
    updatedFirstMessage: "new greeting"
  };
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  document.body.dataset.status = passed ? "pass" : "fail";
  document.querySelector("pre").textContent = JSON.stringify({ passed, actual, expected }, null, 2);
  clearWasmoonEngine(mode);
}
main().catch((error) => {
  document.body.dataset.status = "error";
  document.querySelector("pre").textContent = error instanceof Error ? `${error.name}: ${error.message}
${error.stack ?? ""}` : String(error);
});
