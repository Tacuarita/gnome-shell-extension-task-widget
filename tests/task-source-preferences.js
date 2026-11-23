// Run with: gjs -m tests/task-source-preferences.js
// Exercise account enumeration without opening a GTK window or real task data.
import Gio from 'gi://Gio';
import * as Utils from '../src/utils.js';

const prefs = Gio.File.new_for_uri(import.meta.url)
    .get_parent().get_parent().get_child('src/prefs.js');
const [, bytes] = prefs.load_contents(null);
const source = new TextDecoder().decode(bytes);
const start = source.indexOf('        async _listTaskListsAndAccounts(');
const end = source.indexOf('\n        /**', start);
const errors = [];
const rows = [];
const sources = new Map([
    ['account', {display_name: 'Radicale'}],
    ['local-stub', {display_name: 'On This Computer'}]
]);
const registry = {
    ref_source(uid) {
        if (!uid) throw new Error('Argument uid may not be null');
        return sources.get(uid) ?? null;
    }
};
const clients = [
    ['Account Calendar', 'account', true],
    ['Standalone Calendar', null, true],
    ['Personal', 'local-stub', false]
].map(([name, parent, remote]) => ({
    source: {display_name: name, get_parent: () => parent},
    check_refresh_supported: () => remote
}));
const Subject = new Function('Utils', 'Gio', 'TaskListRow', '_', 'logError',
    `return class { ${source.slice(start, end)} };`)(
    Utils, Gio, class { constructor(client) { this.name = client.source.display_name; } },
    text => text, error => errors.push(error));
const subject = new Subject();
subject._initRegistry = async () => {};
subject._clients = new Map(clients.map((client, index) => [index, client]));
subject._sourceRegistry = registry;
subject._taskListBox = {append: row => rows.push(row)};
subject._backendRefreshButton = {
    set_sensitive() {}, set_tooltip_text() {},
    set_menu_model() {}, insert_action_group() {}
};
await subject._listTaskListsAndAccounts();
if (errors.length) throw errors[0];
if (rows.length !== 3)
    throw new Error(`Expected all three task lists, got ${rows.length}`);
const providerStart = source.indexOf('\n',
    source.indexOf('this.set_title(this._source.display_name);'));
const providerEnd = source.indexOf('this._taskListSwitch.active', providerStart);
const setProvider = new Function('widget', '_', 'Utils',
    source.slice(providerStart, providerEnd));
const providers = [];
for (const client of clients) {
    setProvider.call({
        _source: client.source,
        _taskListProvider: {set_text: text => providers.push(text)}
    }, {_sourceRegistry: registry}, text => text, Utils);
}
if (providers.join('|') !== 'Radicale|Standalone|On This Computer')
    throw new Error('Task source provider labels are incorrect');
print('PASS: account, standalone and local task lists all appear');
