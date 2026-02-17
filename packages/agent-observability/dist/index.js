"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresObservabilityStore = void 0;
exports.getObservabilityStore = getObservabilityStore;
const postgres_store_1 = require("./postgres-store");
Object.defineProperty(exports, "PostgresObservabilityStore", { enumerable: true, get: function () { return postgres_store_1.PostgresObservabilityStore; } });
const DEFAULT_DATABASE_URL = "postgres://agent:agent@127.0.0.1:55432/agent_observability";
let singleton = null;
function createStore() {
    return new postgres_store_1.PostgresObservabilityStore(process.env.AGENT_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
}
function getObservabilityStore() {
    if (!singleton) {
        singleton = createStore();
    }
    return singleton;
}
