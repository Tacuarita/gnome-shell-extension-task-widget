import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {
    gettext as _
} from 'resource:///org/gnome/shell/extensions/extension.js';
import {readFields, saveTask, deleteTask} from './taskStore.js';

export const TaskEditor = GObject.registerClass(
class TaskEditor extends St.BoxLayout {
    _init(lists, selectedUid, task = null, parent = null) {
        super._init({
            style_class: 'task-widget-editor',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: false
        });
        this._task = task?.clone() ?? null;
        this._parent = parent?.clone() ?? null;
        this._cancellable = new Gio.Cancellable();
        this._alive = true;
        this.add_child(new St.Label({
            text: task ? _('Edit task')
                : parent ? _('Add subtask') : _('Add task'),
            style_class: 'task-widget-editor-title'
        }));
        this._canChooseList = !task && !parent && lists.length > 1;
        this._listButton = this._button('', () => {
            this._listChoices.visible = !this._listChoices.visible;
        });
        this._listChoices = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL, visible: false
        });
        for (const list of lists) {
            const choice = this._button(list.name, () =>
                this._selectList(list));
            this._listChoices.add_child(choice);
        }
        this.add_child(this._listButton);
        this.add_child(this._listChoices);
        this._selectList(
            lists.find(list => list.uid === selectedUid) ?? lists[0]);
        this._listButton.reactive = this._canChooseList;
        this._listButton.can_focus = this._canChooseList;
        this._listButton.visible = this._canChooseList || !lists.length;

        const fields = readFields(task);
        this._titleEntry = this._entry(_('Title'), fields.title);
        this._notesEntry = this._entry(_('Details'), fields.notes);
        this._notesEntry.clutter_text.set_single_line_mode(false);
        this._notesEntry.clutter_text.set_line_wrap(true);
        this._notesEntry.add_style_class_name('task-widget-editor-notes');
        const dates = new St.BoxLayout({
            style_class: 'task-widget-editor-buttons', y_expand: false
        });
        for (const [label, offset] of [[_('Today'), 0], [_('Tomorrow'), 1]]) {
            dates.add_child(this._button(label, () => {
                this._dueEntry.text = GLib.DateTime.new_now_local()
                    .add_days(offset).format('%Y-%m-%d');
            }));
        }
        dates.add_child(this._button(_('No date'), () => {
            this._dueEntry.text = '';
        }));
        this._dateButtons = dates.get_children();
        this.add_child(dates);
        this._dueEntry = this._entry(
            _('Due date'), fields.due, _('YYYY-MM-DD (optional)'));
        this._error = new St.Label({
            style_class: 'task-widget-editor-error', visible: false
        });
        this._error.clutter_text.set_line_wrap(true);
        this.add_child(this._error);
        const buttons = new St.BoxLayout({
            style_class: 'task-widget-editor-buttons', y_expand: false
        });
        this._cancelButton = this._button(_('Cancel'), () => this.close());
        this._saveButton = this._button(_('Save'), () => this._save());
        buttons.add_child(this._cancelButton);
        buttons.add_child(this._saveButton);
        this.add_child(buttons);
        this._titleEntry.clutter_text.connect('activate', () => this._save());
        this._dueEntry.clutter_text.connect('activate', () => this._save());
        this.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;
            this.close();
            return Clutter.EVENT_STOP;
        });
        this.connect('destroy', () => {
            this._alive = false;
            this._cancellable.cancel();
        });
    }

    _button(label, action) {
        const button = new St.Button({label, style_class: 'button',
            can_focus: true, x_expand: true, y_expand: false});
        button.connect('clicked', action);
        return button;
    }

    _selectList(list) {
        this._selected = list;
        this._listButton.label = list?.name ?? _('No writable task lists');
        this._listChoices.hide();
    }

    _entry(label, text, hint = label) {
        const entry = new St.Entry({text, hint_text: hint,
            can_focus: true, x_expand: true, y_expand: false});
        entry.accessible_name = label;
        this.add_child(entry);
        return entry;
    }

    open() {
        this.show();
        this._titleEntry.grab_key_focus();
        return true;
    }

    close() {
        if (!this._saving) this.destroy();
    }

    async _save() {
        if (this._saving) return;
        this._error.hide();
        this._error.text = '';
        if (!this._selected) {
            this._error.text = _('No writable task lists are available.');
            this._error.show();
            return;
        }
        this._saving = true;
        this._saveButton.label = _('Saving…');
        this._listChoices.hide();
        const controls = [
            this._saveButton, this._cancelButton, this._listButton,
            this._titleEntry, this._notesEntry, this._dueEntry,
            ...this._dateButtons
        ];
        controls.forEach(control => { control.reactive = false; });
        const entries = [this._titleEntry, this._notesEntry, this._dueEntry];
        entries.forEach(entry => { entry.clutter_text.editable = false; });
        try {
            this.savedUid = await saveTask(this._selected.client, this._task, {
                title: this._titleEntry.text,
                notes: this._notesEntry.text,
                due: this._dueEntry.text
            }, this._cancellable, this._parent);
            if (this._alive) this.destroy();
        } catch (error) {
            if (this._alive) {
                this._error.text = error.message;
                this._error.show();
            }
        } finally {
            this._saving = false;
            if (this._alive) {
                this._saveButton.label = _('Save');
                controls.forEach(control => { control.reactive = true; });
                entries.forEach(entry => {
                    entry.clutter_text.editable = true;
                });
                this._listButton.reactive = this._canChooseList;
            }
        }
    }
});

export const TaskDeleteConfirmation = GObject.registerClass(
class TaskDeleteConfirmation extends St.BoxLayout {
    _init(client, task) {
        super._init({style_class: 'task-widget-editor',
            orientation: Clutter.Orientation.VERTICAL, y_expand: false});
        this._client = client;
        this._task = task.clone();
        this._cancellable = new Gio.Cancellable();
        this._alive = true;
        const title = new St.Label({text: _('Delete task?'),
            style_class: 'task-widget-editor-title'});
        const message = new St.Label({text: readFields(task).title});
        message.clutter_text.set_line_wrap(true);
        const explanation = new St.Label({text: _(
            'The task and its subtasks will be permanently deleted, ' +
            'including recurring instances.')});
        explanation.clutter_text.set_line_wrap(true);
        this._error = new St.Label({
            style_class: 'task-widget-editor-error', visible: false
        });
        this._error.clutter_text.set_line_wrap(true);
        for (const actor of [title, message, explanation, this._error])
            this.add_child(actor);
        const buttons = new St.BoxLayout({
            style_class: 'task-widget-editor-buttons', y_expand: false
        });
        this._cancelButton = new St.Button({label: _('Cancel'),
            style_class: 'button', can_focus: true, x_expand: true});
        this._cancelButton.connect('clicked', () => this.close());
        this._deleteButton = new St.Button({label: _('Delete'),
            style_class: 'button destructive-action',
            can_focus: true, x_expand: true});
        this._deleteButton.connect('clicked', () => this._delete());
        buttons.add_child(this._cancelButton);
        buttons.add_child(this._deleteButton);
        this.add_child(buttons);
        this.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;
            this.close();
            return Clutter.EVENT_STOP;
        });
        this.connect('destroy', () => {
            this._alive = false;
            this._cancellable.cancel();
        });
    }

    open() {
        this.show();
        this._cancelButton.grab_key_focus();
        return true;
    }

    close() {
        if (!this._saving) this.destroy();
    }

    async _delete() {
        if (this._saving) return;
        this._saving = true;
        this._deleteButton.label = _('Deleting…');
        this._cancelButton.reactive = false;
        this._deleteButton.reactive = false;
        this._error.hide();
        try {
            await deleteTask(this._client, this._task, this._cancellable);
            this.deleted = true;
            if (this._alive) this.destroy();
        } catch (error) {
            if (this._alive) {
                this._error.text = error.message;
                this._error.show();
            }
        } finally {
            this._saving = false;
            if (this._alive) {
                this._deleteButton.label = _('Delete');
                this._cancelButton.reactive = true;
                this._deleteButton.reactive = true;
            }
        }
    }
});
