import ECal from 'gi://ECal';
import GLib from 'gi://GLib';
import ICalGLib from 'gi://ICalGLib';

import * as Utils from './utils.js';
import {
    gettext as _
} from 'resource:///org/gnome/shell/extensions/extension.js';

export function readFields(task) {
    const due = task?.get_due()?.get_value();
    const date = due
        ? [due.get_year(), due.get_month(), due.get_day()]
            .map((value, index) => String(value).padStart(index ? 2 : 4, '0'))
            .join('-')
        : '';
    return {
        title: task?.get_summary()?.get_value() ?? '',
        notes: task?.get_descriptions()
            .map(text => text.get_value()).join('\n') ?? '',
        due: date
    };
}

export function updateTask(task, fields) {
    const title = fields.title.trim();
    const date = fields.due.trim();
    if (!title) throw new Error(_('Enter a task title.'));
    let due = null;
    if (date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
            throw new Error(_(
                'Enter the due date as YYYY-MM-DD, or leave it empty.'));
        if (!GLib.Date.valid_dmy(Number(date.slice(8, 10)),
            Number(date.slice(5, 7)), Number(date.slice(0, 4))))
            throw new Error(_('Enter a valid due date.'));
        due = ICalGLib.Time.new_from_string(date.replaceAll('-', ''));
        if (!due || !due.is_valid_time() ||
            due.get_year() !== Number(date.slice(0, 4)) ||
            due.get_month() !== Number(date.slice(5, 7)) ||
            due.get_day() !== Number(date.slice(8, 10)))
            throw new Error(_('Enter a valid due date.'));
    }
    const original = readFields(task);
    const result = task ? task.clone() : ECal.Component.new();
    if (!task) {
        result.set_new_vtype(ECal.ComponentVType.TODO);
        result.set_status(ICalGLib.PropertyStatus.NEEDSACTION);
    }
    if (title !== original.title)
        result.set_summary(ECal.ComponentText.new(title, null));
    if (fields.notes !== original.notes)
        result.set_descriptions(fields.notes
            ? [ECal.ComponentText.new(fields.notes, null)] : []);
    if (date !== original.due)
        result.set_due(due ? ECal.ComponentDateTime.new(due, null) : null);
    result.commit_sequence();
    return result;
}

export async function saveTask(
    client, task, fields, cancellable, parent = null
) {
    if (client.is_readonly())
        throw new Error(_('This task list is read-only.'));
    // Validate before making a request; work on a copy of the current task.
    updateTask(task, fields);
    if (task) {
        const current = await new Promise((resolve, reject) => {
            client.get_object(
                task.get_uid(), task.get_recurid_as_string() || null,
                cancellable, (self, result) => {
                    try {
                        resolve(ECal.Component.new_from_icalcomponent(
                            self.get_object_finish(result)[1]));
                    } catch (error) { reject(error); }
                });
        });
        const before = readFields(task);
        const latest = readFields(current);
        if (Object.keys(before).some(key => before[key] !== latest[key]))
            throw new Error(_(
                'This task changed elsewhere. Close and reopen the editor.'));
        const updated = updateTask(current, fields);
        await Utils.modifyObjects_(client, [updated.get_icalcomponent()],
            ECal.ObjModType.THIS, ECal.OperationFlags.NONE, cancellable);
        return task.get_uid();
    }
    const created = updateTask(null, fields);
    if (parent) {
        // Confirm that the parent still exists before adding a child.
        await new Promise((resolve, reject) => {
            client.get_object(
                parent.get_uid(), parent.get_recurid_as_string() || null,
                cancellable, (self, result) => {
                    try { self.get_object_finish(result); resolve(); }
                    catch (error) { reject(error); }
                });
        });
        created.get_icalcomponent().add_property(
            ICalGLib.Property.new_relatedto(parent.get_uid()));
    }
    return new Promise((resolve, reject) => {
        client.create_object(
            created.get_icalcomponent(), ECal.OperationFlags.NONE,
            cancellable, (self, result) => {
                try { resolve(self.create_object_finish(result)[1]); }
                catch (error) { reject(error); }
            });
    });
}

export async function deleteTask(client, task, cancellable) {
    if (client.is_readonly())
        throw new Error(_('This task list is read-only.'));
    const tasks = await Utils.getTasks_(client, '#t', cancellable);
    const uids = new Set([task.get_uid()]);
    // Include descendants, even when hidden by the widget's current filters.
    let previousSize;
    do {
        previousSize = uids.size;
        for (const candidate of tasks) {
            // Read UID before starting libical's mutable property iterator.
            const candidateUid = candidate.get_uid();
            const component = candidate.get_icalcomponent();
            const kind = ICalGLib.PropertyKind.RELATEDTO_PROPERTY;
            let relation = component.get_first_property(kind);
            while (relation) {
                const type = relation.get_first_parameter(
                    ICalGLib.ParameterKind.RELTYPE_PARAMETER);
                const isParent = !type ||
                    type.get_reltype() === ICalGLib.ParameterReltype.PARENT;
                if (isParent &&
                    uids.has(relation.get_relatedto()))
                    uids.add(candidateUid);
                relation = component.get_next_property(kind);
            }
        }
    } while (previousSize !== uids.size);
    const ids = [...uids].reverse()
        .map(uid => ECal.ComponentId.new(uid, null));
    await new Promise((resolve, reject) => {
        client.remove_objects(
            ids, ECal.ObjModType.ALL, ECal.OperationFlags.NONE,
            cancellable, (self, result) => {
                try { self.remove_objects_finish(result); resolve(); }
                catch (error) { reject(error); }
            });
    });
}
