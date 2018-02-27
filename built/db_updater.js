"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const async = require("async");
const fs = require("fs");
const path = require("path");
const glob = require("glob");
const qtopology = require("qtopology");
/////////////////////////////////////////////////////////////////////////
/**
 * Internal class for storing data about upgrade-script file.
 */
class FileRec {
}
/**
 * This class handles automatic upgrades of underlaying database.
 */
class DbUpgrader {
    /** Simple constructor */
    constructor(options) {
        this.scripts_dir = options.scripts_dir;
        this.conn = options.conn;
        this.settings_table = options.settings_table || "Settings";
        this.version_record_key = options.version_record_key || "dbver";
        this.inner_glob = options.glob || glob;
        this.inner_fs = options.fs || fs;
        this.log_prefix = options.log_prefix || "[qtopology-mysql DbUpgrader] ";
    }
    /** Internal logging utility method */
    log(s) {
        qtopology.logger().debug(this.log_prefix + s);
    }
    /** This method just check's if database version is in sync with code version. */
    check(callback) {
        let self = this;
        let files = [];
        let curr_version = -1;
        async.series([
            (xcallback) => {
                self.log("Fetching version from database...");
                let script = "select value from " + self.settings_table + " where name = '" + self.version_record_key + "';";
                self.conn.query(script, function (err, rows) {
                    if (err)
                        return xcallback(err);
                    if (rows.length > 0) {
                        curr_version = rows[0].value;
                    }
                    self.log("Current version: " + curr_version);
                    xcallback();
                });
            },
            (xcallback) => {
                self.log("Checking files in script directory: " + self.scripts_dir);
                let file_names = this.inner_glob.sync(path.join(self.scripts_dir, "v*.sql"));
                let xfiles = file_names.map(x => {
                    let r = new FileRec();
                    r.file = x;
                    r.file_short = path.basename(x);
                    return r;
                });
                xfiles.forEach(x => {
                    let tmp = path.basename(x.file);
                    x.ver = +(tmp.replace("v", "").replace(".sql", ""));
                });
                xfiles.sort((a, b) => { return a.ver - b.ver; });
                files = xfiles;
                xcallback();
            },
            (xcallback) => {
                self.log("Finished.");
                if (files.length == 0) {
                    return xcallback(new Error("Directory with SQL version upgrades is empty."));
                }
                let code_version = files[files.length - 1].ver;
                if (code_version != curr_version) {
                    return xcallback(new Error(`Version mismatch in QTopology SQL: ${curr_version} in db, ${code_version}`));
                }
                xcallback();
            }
        ], callback);
    }
    /** Sequentially executes upgrade files. */
    run(callback) {
        let self = this;
        let files = [];
        let curr_version = -1;
        async.series([
            (xcallback) => {
                let file_name = "init.sql";
                self.log("Executing upgrade file: " + file_name);
                let script = this.inner_fs.readFileSync(path.join(self.scripts_dir, file_name), "utf8");
                self.conn.query(script, (err) => {
                    if (err) {
                        console.log(err);
                    }
                    xcallback(err);
                });
            },
            (xcallback) => {
                self.log("Fetching files in script directory: " + self.scripts_dir);
                let file_names = this.inner_glob.sync(path.join(self.scripts_dir, "v*.sql"));
                let xfiles = file_names.map(x => {
                    let r = new FileRec();
                    r.file = x;
                    r.file_short = path.basename(x);
                    return r;
                });
                xfiles.forEach(x => {
                    let tmp = path.basename(x.file);
                    x.ver = +(tmp.replace("v", "").replace(".sql", ""));
                });
                xfiles.sort((a, b) => { return a.ver - b.ver; });
                files = xfiles;
                xcallback();
            },
            (xcallback) => {
                self.log("Fetching version from database...");
                let script = "select value from " + self.settings_table + " where name = '" + self.version_record_key + "';";
                self.conn.query(script, function (err, rows) {
                    if (err)
                        return xcallback(err);
                    if (rows.length > 0) {
                        curr_version = rows[0].value;
                    }
                    self.log("Current version: " + curr_version);
                    xcallback();
                });
            },
            (xcallback) => {
                self.log("Detecting applicable upgrade files...");
                files = files.filter(x => x.ver > curr_version);
                files = files.sort((a, b) => { return a.ver - b.ver; });
                xcallback();
            },
            (xcallback) => {
                self.log("Number of applicable upgrade files: " + files.length);
                async.eachSeries(files, (item, xxcallback) => {
                    self.log("Executing upgrade file: " + item.file_short);
                    let script = this.inner_fs.readFileSync(item.file, "utf8");
                    self.conn.query(script, (err) => {
                        if (err) {
                            console.log(err);
                            return xxcallback(err);
                        }
                        self.log("Updating version in db to " + item.ver);
                        let script2 = `update ${self.settings_table} set value = '${item.ver}' where name = '${self.version_record_key}'`;
                        self.conn.query(script2, xxcallback);
                    });
                }, xcallback);
            },
            (xcallback) => {
                self.log("Finished.");
                xcallback();
            }
        ], callback);
    }
}
exports.DbUpgrader = DbUpgrader;
//# sourceMappingURL=db_updater.js.map