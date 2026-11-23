// Run with: bash tests/run.sh /path/to/extension.zip tests/task-layout.js
import Clutter from 'gi://Clutter';
import EDataServer from 'gi://EDataServer';
import ECal from 'gi://ECal';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export const METRICS = {};

export async function run() {
    const extension = Main.extensionManager.lookup(
        'task-widget@juozasmiskinis.gitlab.io');
    const widget = extension.stateObj._widget;
    const Store = await import(extension.dir.get_uri() + '/taskStore.js');
    const Utils = await import(extension.dir.get_uri() + '/utils.js');
    for (let i = 0; i < 50 && !widget._sourceRegistry; i++)
        await Scripting.sleep(100);

    const registry = widget._sourceRegistry;
    const source = EDataServer.Source.new_with_uid(GLib.uuid_string_random(), null);
    source.display_name = 'Layout test';
    source.parent = 'local-stub';
    source.get_extension(EDataServer.SOURCE_EXTENSION_TASK_LIST).backend_name = 'local';
    registry.commit_source_sync(source, null);
    await Scripting.sleep(300);
    const client = await Utils.getECalClient_(registry.ref_source(source.uid),
        ECal.ClientSourceType.TASKS, 5);
    widget._settings.set_int('hide-completed-tasks', 0);
    for (const title of ['One', 'Two', 'Three', 'Four'])
        await Store.saveTask(client, null, {title, notes: '', due: ''},
            new Gio.Cancellable());
    await Scripting.sleep(500);
    Main.overview.hide();
    await Scripting.sleep(300);
    const menu = Main.panel.statusArea.dateMenu.menu;
    menu.open();
    await Scripting.sleep(300);
    await widget._showActiveTaskList(
        widget._taskLists.findIndex(list => list.uid === source.uid));
    await Scripting.sleep(500);

    const rows = () => widget._taskBox.get_children().filter(row => row._task);
    const check = (label, count = 4) => {
        if (rows().length !== count)
            throw new Error(`Expected ${count} task rows after ${label}`);
        for (const row of rows()) {
            const height = row.get_height();
            const natural = row.get_preferred_height(row.width)[1];
            const expanding = row.needs_expand(Clutter.Orientation.VERTICAL);
            print(`${label}: height=${height}, natural=${natural}, expand=${expanding}`);
            if (height > natural + 1)
                throw new Error(`Rows stretch after ${label}: ${height} > ${natural}`);
        }
    };
    check('initial');
    rows()[0].add_style_pseudo_class('hover');
    await Scripting.sleep(150);
    check('hover');
    rows()[0].remove_style_pseudo_class('hover');
    const checkbox = rows()[0];
    checkbox.grab_key_focus();
    checkbox.checked = true;
    await widget._taskClicked(checkbox,
        widget._clientViews.get(source.uid).client);
    await Scripting.sleep(500);
    check('completion');

    const actionButton = rows()[1].child.get_last_child();
    actionButton.grab_key_focus();
    actionButton.emit('clicked', 1);
    await Scripting.sleep(200);
    check('actions menu');
    widget._closeTaskActions();

    widget._addTaskButton.emit('clicked', 1);
    await Scripting.sleep(200);
    widget._editor.close();
    await Scripting.sleep(200);
    menu.open();
    await Scripting.sleep(500);
    check('editor canceled');

    widget._addTaskButton.emit('clicked', 1);
    await Scripting.sleep(200);
    widget._editor._titleEntry.text = 'Five';
    await widget._editor._save();
    await Scripting.sleep(200);
    menu.open();
    await Scripting.sleep(500);
    check('task added', 5);
    print('PASS: compact task row layout after all interactions');
    await Main.extensionManager.disableExtension(extension.uuid);
}
