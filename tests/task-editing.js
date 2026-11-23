// Use an isolated D-Bus session AND XDG_DATA_HOME/XDG_CONFIG_HOME to keep
// Evolution Data Server test sources separate from the user's task lists.
import EDataServer from 'gi://EDataServer';
import ECal from 'gi://ECal';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import ICalGLib from 'gi://ICalGLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export const METRICS = {};
function assert(value, message) {
    if (!value) throw new Error(message);
}

export async function run() {
    const extension = Main.extensionManager.lookup('task-widget@juozasmiskinis.gitlab.io');
    const widget = extension.stateObj._widget;
    const Store = await import(extension.dir.get_uri() + '/taskStore.js');
    const Utils = await import(extension.dir.get_uri() + '/utils.js');
    const {TaskEditor, TaskDeleteConfirmation} = await import(extension.dir.get_uri() + '/taskEditor.js');
    for (let i = 0; i < 50 && !widget._sourceRegistry; i++)
        await Scripting.sleep(100);
    const registry = widget._sourceRegistry;
    assert(registry, 'Registry did not initialize');
    const source = EDataServer.Source.new_with_uid(GLib.uuid_string_random(), null);
    source.display_name = 'Task Widget test list';
    source.parent = 'local-stub';
    source.get_extension(EDataServer.SOURCE_EXTENSION_TASK_LIST).backend_name = 'local';
    registry.commit_source_sync(source, null);
    await Scripting.sleep(500);
    const registered = registry.ref_source(source.uid);
    const client = await new Promise((resolve, reject) => {
        ECal.Client.connect(registered, ECal.ClientSourceType.TASKS, 5, null, (self, result) => {
            try { resolve(ECal.Client.connect_finish(result)); }
            catch (error) { reject(error); }
        });
    });
    const lists = [{uid: source.uid, name: source.display_name, client}];
    const read = uid => new Promise((resolve, reject) => {
        client.get_object(uid, null, null, (self, result) => {
            try { resolve(ECal.Component.new_from_icalcomponent(self.get_object_finish(result)[1])); }
            catch (error) { reject(error); }
        });
    });
    const fields = {title: 'Test parent', notes: 'Line one\nLine two', due: '2026-12-05'};
    const cancellable = new Gio.Cancellable();
    const dialog = new TaskEditor(lists, source.uid);
    widget._mountInlineEditor(dialog);
    await dialog._save();
    assert(dialog._error.text.length > 0, 'Blank title was accepted');
    dialog._titleEntry.text = fields.title;
    dialog._notesEntry.text = fields.notes;
    dialog._dateButtons[0].emit('clicked', 1);
    assert(dialog._dueEntry.text === GLib.DateTime.new_now_local().format('%Y-%m-%d'),
        'Today shortcut selected the wrong date');
    dialog._dateButtons[2].emit('clicked', 1);
    assert(dialog._dueEntry.text === '', 'No date shortcut did not clear the date');
    dialog._dueEntry.text = '2026-02-30';
    await dialog._save();
    assert(dialog._error.text.length > 0, 'Invalid date was accepted');
    dialog._dueEntry.text = fields.due;
    await dialog._save();
    assert(dialog.savedUid, 'Create failed: ' + dialog._error.text);
    await Scripting.sleep(150);
    let parent = await read(dialog.savedUid);
    assert(JSON.stringify(Store.readFields(parent)) === JSON.stringify(fields), 'Create did not persist fields');
    Main.overview.hide();
    Main.panel.statusArea.dateMenu.menu.open();
    await Scripting.sleep(300);
    const index = widget._taskLists.findIndex(list => list.uid === source.uid);
    assert(index !== -1, 'New source is not available in widget');
    await widget._showActiveTaskList(index);
    await Scripting.sleep(400);
    const findTask = actor => {
        if (actor._task?.get_uid() === parent.get_uid()) return actor;
        for (const child of actor.get_children()) {
            const found = findTask(child);
            if (found) return found;
        }
        return null;
    };
    const checkbox = findTask(widget._taskBox);
    assert(checkbox?._actionsButton, 'Task action button is missing');
    const actionIcon = checkbox._actionsButton.child.get_theme_node();
    assert(actionIcon.get_foreground_color().alpha > 0, 'Task menu icon is invisible');
    assert(actionIcon.get_border_width(0) === 0, 'Task menu icon looks like a checkbox');
    checkbox._actionsButton.emit('clicked', 1);
    await Scripting.sleep(200);
    assert(widget._taskActions, 'Click did not expand task actions');
    assert(!checkbox.checked, 'Opening task menu marked task complete');
    const modalCount = Main.layoutManager.modalDialogGroup.get_n_children();
    const actions = widget._taskActions.get_children();
    assert(actions.length === 3, 'Expected Edit, Add subtask and Delete actions');
    actions[0].emit('clicked', 1);
    await Scripting.sleep(200);
    assert(widget._editor?._task, 'Edit action did not open editor');
    assert(Main.panel.statusArea.dateMenu.menu.isOpen, 'Inline editor closed calendar');
    assert(widget._editor.get_parent() === widget._taskBox, 'Editor is outside task list');
    assert(Main.layoutManager.modalDialogGroup.get_n_children() === modalCount,
        'Editing created an external modal');
    const draft = widget._editor;
    draft._titleEntry.text = 'Unsaved draft';
    await Utils.modifyObjects_(client, [parent.get_icalcomponent()],
        ECal.ObjModType.THIS, ECal.OperationFlags.NONE);
    await Scripting.sleep(200);
    assert(widget._editor === draft && draft._titleEntry.text === 'Unsaved draft',
        'Backend notification replaced the inline draft');
    Main.panel.statusArea.dateMenu.menu.close();
    await Scripting.sleep(150);
    Main.panel.statusArea.dateMenu.menu.open();
    await Scripting.sleep(200);
    assert(widget._editor === draft && draft._titleEntry.text === 'Unsaved draft',
        'Closing the calendar discarded the draft');
    const [dialogWidth, dialogHeight] = widget._editor.get_transformed_size();
    assert(dialogWidth > 0 && dialogHeight > 0 && dialogHeight <= global.stage.height,
        'Editor does not fit on screen');
    if (GLib.getenv('TASK_WIDGET_TEST_SCREENSHOT')) {
        const stream = Gio.File.new_for_path(GLib.getenv('TASK_WIDGET_TEST_SCREENSHOT'))
            .replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Shell.Screenshot().screenshot(false, stream);
        stream.close(null);
    }
    widget._editor.close();
    await Scripting.sleep(150);
    findTask(widget._taskBox)._titleButton.emit('clicked', 1);
    await Scripting.sleep(150);
    assert(widget._editor?._task, 'Clicking the title did not open the inline editor');
    widget._editor.close();
    await Scripting.sleep(150);
    const original = parent.clone();
    // A concurrent completion change must survive editing title and notes.
    parent.set_status(ICalGLib.PropertyStatus.COMPLETED);
    parent.set_percent_complete(100);
    parent.set_due(ECal.ComponentDateTime.new(
        ICalGLib.Time.new_from_string('20261205T153000Z'), 'UTC'));
    parent.get_icalcomponent().set_location('Preserve unrelated data');
    await Utils.modifyObjects_(client, [parent.get_icalcomponent()], ECal.ObjModType.THIS, ECal.OperationFlags.NONE);
    const edit = new TaskEditor(lists, source.uid, original);
    widget._mountInlineEditor(edit);
    edit._titleEntry.text = 'Edited parent';
    edit._notesEntry.text = '';
    await edit._save();
    assert(edit.savedUid, 'Edit failed: ' + edit._error.text);
    await Scripting.sleep(150);
    parent = await read(dialog.savedUid);
    assert(parent.get_summary().get_value() === 'Edited parent', 'Title not edited');
    assert(parent.get_status() === ICalGLib.PropertyStatus.COMPLETED, 'Completion was lost');
    assert(parent.get_icalcomponent().get_location() === 'Preserve unrelated data', 'Unrelated field was lost');
    assert(parent.get_descriptions().length === 0, 'Notes were not cleared');
    assert(Store.readFields(parent).due === fields.due, 'Unchanged due date was lost');
    assert(parent.get_due().get_value().as_ical_string() === '20261205T153000Z',
        'Editing the title changed the due time');
    await Store.saveTask(client, parent, {...Store.readFields(parent), due: ''}, cancellable);
    parent = await read(parent.get_uid());
    assert(parent.get_due() === null, 'Due date was not cleared');
    const stale = parent.clone();
    parent.set_summary(ECal.ComponentText.new('Changed elsewhere', null));
    await Utils.modifyObjects_(client, [parent.get_icalcomponent()], ECal.ObjModType.THIS, ECal.OperationFlags.NONE);
    let conflict = false;
    try { await Store.saveTask(client, stale, fields, cancellable); }
    catch (error) { conflict = /changed elsewhere/.test(error.message); }
    assert(conflict, 'Concurrent title edit was overwritten');
    parent = await read(parent.get_uid());
    const childDialog = new TaskEditor(lists, source.uid, null, parent);
    widget._mountInlineEditor(childDialog);
    childDialog._titleEntry.text = 'Test child';
    await childDialog._save();
    assert(childDialog.savedUid, 'Subtask create failed: ' + childDialog._error.text);
    await Scripting.sleep(150);
    const child = await read(childDialog.savedUid);
    assert(child.get_icalcomponent().get_first_property(ICalGLib.PropertyKind.RELATEDTO_PROPERTY).get_relatedto() === parent.get_uid(), 'Subtask has no parent');
    const grandchildUid = await Store.saveTask(client, null,
        {...fields, title: 'Grandchild'}, cancellable, child);
    const unrelatedUid = await Store.saveTask(client, null,
        {...fields, title: 'Unrelated task'}, cancellable);
    const sibling = await read(unrelatedUid);
    const relation = ICalGLib.Property.new_relatedto(parent.get_uid());
    relation.add_parameter(ICalGLib.Parameter.new_reltype(ICalGLib.ParameterReltype.SIBLING));
    sibling.get_icalcomponent().add_property(relation);
    await Utils.modifyObjects_(client, [sibling.get_icalcomponent()], ECal.ObjModType.THIS, ECal.OperationFlags.NONE);
    const canceled = new TaskDeleteConfirmation(client, parent);
    widget._mountInlineEditor(canceled);
    canceled.close();
    await Scripting.sleep(150);
    assert(await read(parent.get_uid()), 'Cancel deleted the task');
    const deletion = new TaskDeleteConfirmation(client, parent);
    widget._mountInlineEditor(deletion);
    await deletion._delete();
    assert(deletion.deleted, 'Delete failed');
    await Scripting.sleep(150);
    for (const uid of [parent.get_uid(), child.get_uid(), grandchildUid]) {
        let missing = false;
        try { await read(uid); } catch { missing = true; }
        assert(missing, 'Task or descendant survived deletion');
    }
    assert(await read(unrelatedUid), 'Unrelated task was deleted');
    let readOnlyRejected = false;
    try { await Store.saveTask({is_readonly: () => true}, null, fields, cancellable); }
    catch { readOnlyRejected = true; }
    assert(readOnlyRejected, 'Read-only list accepted a write');
    await new Promise((resolve, reject) => {
        registered.remove(null, (self, result) => {
            try { self.remove_finish(result); resolve(); }
            catch (error) { reject(error); }
        });
    });
    print('PASS: create, edit, validation, conflict detection, subtasks, confirmed deletion, cancel and read-only lists');
    await Main.extensionManager.disableExtension(extension.uuid);
}
