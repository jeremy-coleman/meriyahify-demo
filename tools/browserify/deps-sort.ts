
import { createHash } from 'crypto'
import { through } from './streams'

function shasum1 (str, alg?, format?) {
  str = 'string' === typeof str ? str
    : Buffer.isBuffer(str) ? str
    : JSON.stringify(str)
  return createHash(alg || 'sha1').update(str, Buffer.isBuffer(str) ? null : 'utf8').digest(format || 'hex')
}

//function murmurhash2_32_gc(str: string) {
    function shasum(str: string) {
        var l = str.length,
          h = l ^ l,
          i = 0,
          k
      
        while (l >= 4) {
          k =
            (str.charCodeAt(i) & 0xff) |
            ((str.charCodeAt(++i) & 0xff) << 8) |
            ((str.charCodeAt(++i) & 0xff) << 16) |
            ((str.charCodeAt(++i) & 0xff) << 24)
      
          k = (k & 0xffff) * 0x5bd1e995 + ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16)
          k ^= k >>> 24
          k = (k & 0xffff) * 0x5bd1e995 + ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16)
      
          h =
            ((h & 0xffff) * 0x5bd1e995 +
              ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16)) ^
            k
      
          l -= 4
          ++i
        }
      
        switch (l) {
          case 3:
            h ^= (str.charCodeAt(i + 2) & 0xff) << 16
          case 2:
            h ^= (str.charCodeAt(i + 1) & 0xff) << 8
          case 1:
            h ^= str.charCodeAt(i) & 0xff
            h =
              (h & 0xffff) * 0x5bd1e995 + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16)
        }
      
        h ^= h >>> 13
        h = (h & 0xffff) * 0x5bd1e995 + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16)
        h ^= h >>> 15
      
        return (h >>> 0).toString(36)
      }

function sortDependencies(opts) {
    if (!opts) opts = {};
    var rows = [];
    return through.obj(write, end);
    
    function write (row, enc, next) { rows.push(row); next() }
    
    function end () {
        var tr = this;
        rows.sort(cmp);
        sorter(rows, tr, opts);
    }
};

function sorter (rows, tr, opts) {
    var expose = opts.expose || {};
    if (Array.isArray(expose)) {
        expose = expose.reduce(function (acc, key) {
            acc[key] = true;
            return acc;
        }, {});
    }
    
    var hashes = {}, deduped = {};
    var sameDeps = depCmp();
    
    if (opts.dedupe) {
        rows.forEach(function (row) {
            var h = shasum(row.source);
            sameDeps.add(row, h);
            if (hashes[h]) {
                hashes[h].push(row);
            } else {
                hashes[h] = [row];
            }
        });
        Object.keys(hashes).forEach(function (h) {
            var rows = hashes[h];
            while (rows.length > 1) {
                var row = rows.pop();
                row.dedupe = rows[0].id;
                row.sameDeps = sameDeps.cmp(rows[0].deps, row.deps);
                deduped[row.id] = rows[0].id;
            }
        });
    }
    
    if (opts.index) {
        var index = {};
        var offset = 0;
        rows.forEach(function (row, ix) {
            if (has(expose, row.id)) {
                row.index = row.id;
                offset ++;
                if (expose[row.id] !== true) {
                    index[expose[row.id]] = row.index;
                }
            }
            else {
                row.index = ix + 1 - offset;
            }
            index[row.id] = row.index;
        });
        rows.forEach(function (row) {
            row.indexDeps = {};
            Object.keys(row.deps).forEach(function (key) {
                var id = row.deps[key];
                row.indexDeps[key] = index[id];
            });
            if (row.dedupe) {
                row.dedupeIndex = index[row.dedupe];
            }
            tr.push(row);
        });
    }
    else {
        rows.forEach(function (row) { tr.push(row) });
    }
    tr.push(null);
}

function cmp (a, b) {
    return a.id + a.hash < b.id + b.hash ? -1 : 1;
}

function has (obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function depCmp () {
    var deps = {}, hashes = {};
    return { add: add, cmp: cmp }
    
    function add (row, hash) {
        deps[row.id] = row.deps;
        hashes[row.id] = hash;
    }
    function cmp (a, b, limit?) {
        if (!a && !b) return true;
        if (!a || !b) return false;
        
        var keys = Object.keys(a);
        if (keys.length !== Object.keys(b).length) return false;

        for (var i = 0; i < keys.length; i++) {
            var k = keys[i], ka = a[k], kb = b[k];
            var ha = hashes[ka];
            var hb = hashes[kb];
            var da = deps[ka];
            var db = deps[kb];

            if (ka === kb) continue;
            if (ha !== hb || (!limit && !cmp(da, db, 1))) {
                return false;
            }
        }
        return true;
    }
}

export default sortDependencies