"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const port_default = 3306;
const mysql = require("mysql");
const async = require("async");
const path = require("path");
const qtopology = require("qtopology");
const dbu = require("./db_updater");
//////////////////////////////////////////////////////////////////////
// Storage-coordination implementation for MySQL
class MySqlCoordinator {
    constructor(options) {
        this.name = null; // this will be set later
        this.options = JSON.parse(JSON.stringify(options));
        this.pool = mysql.createPool({
            database: options.database,
            host: options.host,
            user: options.user,
            password: options.password,
            port: options.port || port_default,
            multipleStatements: true,
            connectionLimit: 10
        });
    }
    init(callback) {
        this.pool.getConnection((err, conn) => {
            if (err)
                return callback(err);
            let db_upgrader = new dbu.DbUpgrader({
                conn: conn,
                scripts_dir: path.join(__dirname, "/../db"),
                settings_table: "qtopology_settings",
                version_record_key: "db_version"
            });
            db_upgrader.run(callback);
        });
    }
    close(callback) {
        callback = callback || function () { };
        if (this.pool) {
            this.pool.end(callback);
        }
        else {
            callback();
        }
    }
    log(s) {
        qtopology.logger().debug("[MySqlCoordinator] " + s);
    }
    query(sql, obj, callback) {
        try {
            this.log(`${sql} ${obj}`);
            this.pool.query(sql, obj || [], callback);
        }
        catch (e) {
            callback(e);
        }
    }
    getMessages(name, callback) {
        let sql = "CALL qtopology_sp_messages_for_worker(?);";
        let self = this;
        self.query(sql, [name], (err, data) => {
            if (err)
                return callback(err);
            let res = [];
            let ids_to_delete = [];
            for (let rec of data[0]) {
                res.push({ cmd: rec.cmd, content: JSON.parse(rec.content) });
                ids_to_delete.push(rec.id);
            }
            async.each(ids_to_delete, (item, xcallback) => {
                let sql2 = "CALL qtopology_sp_delete_message(?);";
                self.query(sql2, [item], xcallback);
            }, (err) => {
                callback(err, res);
            });
        });
    }
    getWorkerStatus(callback) {
        let self = this;
        let sql = "CALL qtopology_sp_leader_ping(?); CALL qtopology_sp_refresh_statuses();";
        self.query(sql, [self.name], (err) => {
            if (err)
                return callback(err);
            sql = "CALL qtopology_sp_workers();";
            self.query(sql, null, (err, data) => {
                if (err)
                    return callback(err);
                let res = [];
                for (let rec of data[0]) {
                    rec.last_ping = rec.last_ping || new Date();
                    rec.lstatus_ts = rec.lstatus_ts || new Date();
                    res.push({
                        name: rec.name,
                        status: rec.status,
                        lstatus: rec.lstatus,
                        last_ping: rec.last_ping.getTime(),
                        last_ping_d: rec.last_ping,
                        lstatus_ts: rec.lstatus_ts.getTime(),
                        lstatus_ts_d: rec.lstatus_ts
                    });
                }
                callback(null, res);
            });
        });
    }
    getTopologyStatusInternal(sql, obj, callback) {
        let self = this;
        let xsql = "CALL qtopology_sp_refresh_statuses();";
        self.query(xsql, null, (err) => {
            if (err)
                return callback(err);
            self.query(sql, obj, (err, data) => {
                if (err)
                    return callback(err);
                let res = [];
                for (let rec of data[0]) {
                    res.push({
                        uuid: rec.uuid,
                        status: rec.status,
                        worker: rec.worker,
                        weight: rec.weight,
                        enabled: !!rec.enabled,
                        error: rec.error,
                        worker_affinity: (rec.worker_affinity || "").split(",").filter(x => x.length > 0)
                    });
                }
                callback(null, res);
            });
        });
    }
    getTopologyStatus(callback) {
        this.getTopologyStatusInternal("CALL qtopology_sp_topologies();", null, callback);
    }
    getTopologiesForWorker(name, callback) {
        this.getTopologyStatusInternal("CALL qtopology_sp_topologies_for_worker(?);", [name], callback);
    }
    getTopologyInfo(uuid, callback) {
        let self = this;
        let sql = "select uuid, status, worker, weight, enabled, worker_affinity, error, config from qtopology_topology where uuid = ?;";
        self.query(sql, [uuid], (err, data) => {
            if (err)
                return callback(err);
            if (data.length == 0)
                return callback(new Error("Requested topology not found: " + uuid));
            let hit = data[0];
            let config = JSON.parse(hit.config);
            callback(null, {
                enabled: hit.enabled,
                status: hit.status,
                uuid: hit.uuid,
                error: hit.error,
                weight: hit.weight,
                worker_affinity: hit.worker_affinity,
                worker: hit.worker,
                config: config
            });
        });
    }
    getLeadershipStatus(callback) {
        let self = this;
        let sql = "CALL qtopology_sp_refresh_statuses();";
        self.query(sql, null, (err) => {
            if (err)
                return callback(err);
            sql = "CALL qtopology_sp_worker_statuses();";
            self.query(sql, null, (err, data) => {
                if (err)
                    return callback(err);
                data = data[0];
                let hits = data.filter(x => x.lstatus == "leader");
                if (hits.length > 0 && hits[0].cnt > 0)
                    return callback(null, { leadership: "ok" });
                hits = data.filter(x => x.lstatus == "candidate");
                if (hits.length > 0 && hits[0].cnt > 0)
                    return callback(null, { leadership: "pending" });
                callback(null, { leadership: "vacant" });
            });
        });
    }
    registerWorker(name, callback) {
        // this is called once at start-up and is the name of the worker that iuuses this coordination object
        // so we can save the name of the worker and use it later
        let sql = "CALL qtopology_sp_register_worker(?);";
        this.name = name;
        this.query(sql, [name], callback);
    }
    announceLeaderCandidacy(name, callback) {
        let self = this;
        let sql = "CALL qtopology_sp_disable_defunct_leaders();";
        self.query(sql, null, (err) => {
            if (err)
                return callback(err);
            let sql = "CALL qtopology_sp_announce_leader_candidacy(?);";
            self.query(sql, [name], callback);
        });
    }
    checkLeaderCandidacy(name, callback) {
        let self = this;
        let sql = "CALL qtopology_sp_check_leader_candidacy(?);";
        self.query(sql, [name], (err, data) => {
            if (err)
                return callback(err);
            callback(null, data && data.length > 0 && data[0].length > 0 && data[0][0].status == "leader");
        });
    }
    assignTopology(uuid, name, callback) {
        let sql = "CALL qtopology_sp_assign_topology(?, ?);";
        this.query(sql, [uuid, name], callback);
    }
    setTopologyStatus(uuid, status, error, callback) {
        let sql = "CALL qtopology_sp_update_topology_status(?, ?, ?);";
        this.query(sql, [uuid, status, error], callback);
    }
    setWorkerStatus(name, status, callback) {
        let sql = "CALL qtopology_sp_update_worker_status(?, ?);";
        this.query(sql, [name, status], callback);
    }
    registerTopology(uuid, config, callback) {
        let sql = "CALL qtopology_sp_register_topology(?, ?, ?, ?);";
        let affinity = "";
        if (config.general.worker_affinity) {
            affinity = config.general.worker_affinity.join(",");
        }
        let weight = config.general.weight || 1;
        this.query(sql, [uuid, JSON.stringify(config), weight, affinity], callback);
    }
    disableTopology(uuid, callback) {
        let sql = "CALL qtopology_sp_disable_topology(?);";
        this.query(sql, [uuid], callback);
    }
    enableTopology(uuid, callback) {
        let sql = "CALL qtopology_sp_enable_topology(?);";
        this.query(sql, [uuid], callback);
    }
    deleteTopology(uuid, callback) {
        let sql = "CALL qtopology_sp_delete_topology(?);";
        this.query(sql, [uuid], callback);
    }
    getProperties(callback) {
        let res = [];
        res.push({ key: "type", value: "MySqlCoordinator" });
        res.push({ key: "host", value: this.options.host });
        res.push({ key: "database", value: this.options.database });
        res.push({ key: "port", value: this.options.port });
        res.push({ key: "user", value: this.options.user });
        res.push({ key: "multipleStatements", value: true });
        res.push({ key: "connectionLimit", value: 10 });
        callback(null, res);
    }
    sendMessageToWorker(worker, cmd, content, callback) {
        let sql = "CALL qtopology_sp_send_message(?, ?, ?);";
        this.query(sql, [worker, cmd, JSON.stringify(content)], callback);
    }
    stopTopology(uuid, callback) {
        let self = this;
        self.getTopologyInfo(uuid, (err, data) => {
            if (err)
                return callback(err);
            if (!data.worker)
                return callback();
            self.sendMessageToWorker(data.worker, "stop-topology", { uuid: uuid }, callback);
        });
    }
    clearTopologyError(uuid, callback) {
        let self = this;
        self.getTopologyInfo(uuid, (err, data) => {
            if (err)
                return callback(err);
            let hit = data;
            if (hit.status != "error") {
                return callback(new Error("Specified topology is not marked as error: " + uuid));
            }
            self.setTopologyStatus(uuid, "stopped", null, callback);
            callback();
        });
    }
    deleteWorker(name, callback) {
        let self = this;
        self.getWorkerStatus((err, data) => {
            if (err)
                return callback(err);
            let hits = data.filter(x => x.name == name);
            if (hits.length > 0) {
                if (hits[0].status == "unloaded") {
                    self.query("CALL qtopology_sp_delete_worker(?);", [name], callback);
                }
                else {
                    callback(new Error("Specified worker is not unloaded and cannot be deleted."));
                }
            }
            else {
                callback(new Error("Specified worker doesn't exist and thus cannot be deleted."));
            }
        });
    }
    shutDownWorker(name, callback) {
        this.sendMessageToWorker(name, "shutdown", {}, callback);
    }
    getTopologyHistory(uuid, callback) {
        callback(null, []);
    }
    getWorkerHistory(name, callback) {
        callback(null, []);
    }
}
exports.MySqlCoordinator = MySqlCoordinator;
//# sourceMappingURL=mysql_coordinator.js.map
