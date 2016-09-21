var url = require('url'),
    MBTiles = require('mbtiles');

var Plugin = function(config) {
    this.config = config;
    this.mbtiles = {};
    config.beforeState('project:loaded', this.patchMML.bind(this));
    config.on('server:init', this.attachRoutes.bind(this));
};


Plugin.prototype.patchMML = function(e) {
    var mbtilesSource = this;

    for(var i = 0; i < e.project.mml.source.length; i++) {
        var source = e.project.mml.source[i];
        var protocol = source.protocol
        if(protocol != "mbtiles:") {
            continue;
        }

        var sourceUrl = url.parse(source.url);
        var path = sourceUrl.path;

        var id = e.project.id + ":" + i;
        var params = {
            host: e.project.config.parsed_opts.host,
            port: e.project.config.parsed_opts.port,
            query: 'tile={z}/{x}/{y}',
            id: id
        };
        source.url = this._template('http://{host}:{port}/mbtiles/?{query}&id={id}', params);

        this.config.log("Attaching MBTiles " + path);
        new MBTiles("file:///" + path, function(err, source) {
            if(err) {
                mbtilesSource.config.log("Error loading mbtiles" + err);
            } else {
                mbtilesSource.config.log("Loaded MBTiles id:" + id);
                source.getInfo(function(err, info) {
                    if(info) {
                        e.project.mml.sourceMaxzoom = Math.min(info.maxzoom, e.project.mml.sourceMaxzoom || 100);
                    }
                });
            }
            mbtilesSource.mbtiles[id] = source;
            e.continue();
        });
    }
};


Plugin.prototype.attachRoutes = function (e) {
    e.server.addRoute('/mbtiles/', this.serve.bind(this));
};


Plugin.prototype.serve = function (req, res) {
    var requestUrl = url.parse(req.url, true);
    if(!requestUrl.query.tile) {
        return this._respondError(res, "missing tile parameter");
    }
    if(!requestUrl.query.id) {
        return this._respondError(res, "missing id parameter");
    }

    var tile = requestUrl.query.tile.split("/");
    if(tile.length != 3) {
        return this._respondError(res, "Tile parameter must have 3 components");
    }

    var mbtiles = this.mbtiles[requestUrl.query.id];
    if(mbtiles == undefined) {
        return this._respondError(res, "MBTiles not attached");
    }

    var z = parseInt(tile[0]);
    var x = parseInt(tile[1]);
    var y = parseInt(tile[2]);
    this.config.log("Fetching tile " + [z,x,y]);

    mbtiles.getTile(z, x, y, function(err, data, headers) {
        if(err) {
            if(err === "Tile does not exist") {
                res.writeHead(500, {});
            } else {
                res.writeHead(404, {});
            }
            res.write(String(err));
        } else if(data) {
            res.writeHead(200, headers || {});
            res.write(data);
        } else {
            res.writeHead(404, {});
            res.write("Tile not found");
        }
        res.end();
    });
};


Plugin.prototype._respondError = function (res, message) {
    res.writeHead(500, {});
    res.write(message);
    res.end();
};


Plugin.prototype._template = function (str, data) {
    return str.replace(/\{ *([\w_]+) *\}/g, function (str, key) {
        var value = data[key];
        if (value === undefined) {
            throw new Error('No value provided for variable ' + str);
        } else if (typeof value === 'function') {
            value = value(data);
        }
        return value;
    });
}

exports.Plugin = Plugin;
