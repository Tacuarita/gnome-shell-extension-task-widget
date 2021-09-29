'use strict';

const {Gdk, Gio, GLib, GObject, Gtk} = imports.gi;

const Cairo = imports.cairo;
const Gettext = imports.gettext;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;

/* exported ICalGLib */
const {ECal, EDataServer, ICalGLib} = Utils.HAS_EDS_ ? imports.gi : {undefined};
const _ = Gettext.gettext;

// Enable the use of context in translation of plurals:
const _npgettext = (context, singular, plural, n) => {
    if (n !== 1)
        return Gettext.ngettext(`${context}\u0004${singular}`, plural, n);
    else
        return Gettext.pgettext(context, singular);
};

Gio.Resource.load(GLib.build_filenamev([Me.dir.get_path(),
    Me.metadata.gresource]))._register();

/**
 * Used for any one-time setup like translations.
 *
 * https://gjs.guide/extensions/overview/anatomy.html#prefs-js
 */
function init() {
    const dir = Me.metadata.locale === 'user-specific'
        ? Me.dir.get_child('locale').get_path() : Me.metadata.locale;

    Gettext.textdomain(Me.metadata.base);
    Gettext.bindtextdomain(Me.metadata.base, dir);
}

/**
 * Returns the settings widget if Evolution Data Server (and required
 * dependencies) are installed and if there are no prior instances of the
 * settings window. Otherwise, an instance of `BeGoneWidget` is returned.
 *
 * @returns {Gtk.ScrolledWindow} Scrolled window with either widget in it.
 */
function buildPrefsWidget() {
    const scrolledWindow = new Gtk.ScrolledWindow();

    const widget = Gtk.Window.list_toplevels().filter(win => win._uuid &&
        win._uuid === Me.uuid).length === 1 && Utils.HAS_EDS_
        ? new TaskWidgetSettings() : new BeGoneWidget();

    if (Utils.shellVersionAtLeast_(40)) {
        scrolledWindow.set_child(widget);
    } else {
        scrolledWindow.add(widget);
        scrolledWindow.show_all();
    }

    return scrolledWindow;
}

const BeGoneWidget = GObject.registerClass(
class BeGoneWidget extends Gtk.Box {
    /**
     * Shows a message dialog if required dependencies are not installed on the
     * system. Also, closes the settings window if there's another instance of
     * it already opened (only X11 sessions are affected by this).
     */
    _init() {
        super._init();

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            (Utils.shellVersionAtLeast_(40) ? this.get_root()
                : this.get_toplevel()).close();

            if (Utils.HAS_EDS_)
                return;

            let [dialog] = Gtk.Window.list_toplevels().filter(window =>
                window.get_name() === 'task-widget-error');

            if (dialog)
                return;

            dialog = new Gtk.MessageDialog({
                buttons: Gtk.ButtonsType.CLOSE,
                text: _('Error: Missing Dependencies'),
                secondary_text: _('Please install Evolution Data' +
                    ' Server to use this extension.'),
            });

            dialog.add_button(_('Help'), 0);
            dialog.set_name('task-widget-error');
            dialog.present();

            dialog.connect('response', (widget, responseId) =>  {
                if (responseId === 0) {
                    Gio.AppInfo.launch_default_for_uri_async(
                        Me.metadata.dependencies, null, null, null);
                }

                widget.destroy();
            });

            return GLib.SOURCE_REMOVE;
        });
    }
});

const TaskWidgetSettings = GObject.registerClass({
    GTypeName: 'TaskWidgetSettings',
    Template: `resource://${Me.metadata.epath}/settings-window${
        Utils.shellVersionAtLeast_(40) ? '' : '-gtk3'}.ui`,
    InternalChildren: [
        'mtlSwitch',
        'gptSwitch',
        'hhfstlSwitch',
        'heactlSwitch',
        'hctSettingsRevealer',
        'hctComboBox',
        'hctSettingsStack',
        'hctApotacComboBox',
        'hctApotacSpinButton',
        'hctAstodSpinButtonHour',
        'hctAstodSpinButtonMinute',
        'taskListBox',
        'backendRefreshButton',
        'backendRefreshButtonSpinner',
    ],
}, class TaskWidgetSettings extends Gtk.Box {
    /**
     * Initializes the settings widget.
     */
    _init() {
        super._init();
        const provider = new Gtk.CssProvider();
        provider.load_from_resource(`${Me.metadata.epath}/prefs.css`);

        if (Utils.shellVersionAtLeast_(40)) {
            Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(),
                provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        } else {
            Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(),
                provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        }

        this.connect('realize', this._onRealized.bind(this));
        this.connect('unrealize', this._onUnrealized.bind(this));

        const dir = Me.metadata.schemas === 'user-specific'
            ? Me.dir.get_child('schemas').get_path() : Me.metadata.schemas;

        const gschema = Gio.SettingsSchemaSource.new_from_directory(
            dir, Gio.SettingsSchemaSource.get_default(), false);

        this._settings = new Gio.Settings({
            settings_schema: gschema.lookup(Me.metadata.base, true),
        });

        this._hctComboBox.connect('changed', option => {
            switch (option.active) {
                case Utils.HIDE_COMPLETED_TASKS_['never']:
                case Utils.HIDE_COMPLETED_TASKS_['immediately']:
                    this._hctSettingsRevealer.set_reveal_child(false);
                    break;
                case Utils.HIDE_COMPLETED_TASKS_['after-time-period']:
                    this._hctSettingsRevealer.set_reveal_child(true);

                    this._hctSettingsStack.set_visible_child_name(
                        'hctApotacPage');

                    break;
                case Utils.HIDE_COMPLETED_TASKS_['after-specified-time']:
                    this._hctSettingsRevealer.set_reveal_child(true);

                    this._hctSettingsStack.set_visible_child_name(
                        'hctAstodPage');
            }
        });

        this._settings.bind('merge-task-lists', this._mtlSwitch, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('group-past-tasks', this._gptSwitch, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('hide-header-for-singular-task-lists',
            this._hhfstlSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('hide-empty-completed-task-lists',
            this._heactlSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('hide-completed-tasks', this._hctComboBox,
            'active', Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('hct-apotac-value', this._hctApotacSpinButton,
            'value', Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('hct-astod-hour', this._hctAstodSpinButtonHour,
            'value', Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('hct-astod-minute', this._hctAstodSpinButtonMinute,
            'value', Gio.SettingsBindFlags.DEFAULT);

        this._fillApotacComboBox(this._hctApotacSpinButton.value);

        this._settings.bind('hct-apotac-unit', this._hctApotacComboBox,
            'active', Gio.SettingsBindFlags.DEFAULT);

        this._hctApotacSpinButton.connect('value-changed', button =>
            this._fillApotacComboBox(button.get_value(),
                this._hctApotacComboBox.active_id));

        this._hctAstodSpinButtonHour.connect('output', this._timeOutput
            .bind(this));

        this._hctAstodSpinButtonMinute.connect('output', this._timeOutput
            .bind(this));

        if (!Utils.shellVersionAtLeast_(40)) {
            this._taskListBox.set_header_func((row, before) => {
                if (!before || row.get_header())
                    return;

                row.set_header(new Gtk.Separator({
                    orientation: Gtk.Orientation.HORIZONTAL,
                }));
            });
        }

        this._listTaskListsAndAccounts(false, true);
    }

    /**
     * Fills "After a period of time after completion" Gtk.ComboBox with
     * time units.
     *
     * @param {number} duration - Time to elapse before hiding the task.
     * @param {string} [active] - ID of the active Gtk.ComboBox item.
     */
    _fillApotacComboBox(duration, active = null) {
        const time = new Map([
            [Utils.TIME_UNITS_['seconds'], _npgettext('after X second(s)',
                'second', 'seconds', duration)],
            [Utils.TIME_UNITS_['minutes'], _npgettext('after X minute(s)',
                'minute', 'minutes', duration)],
            [Utils.TIME_UNITS_['hours'], _npgettext('after X hour(s)', 'hour',
                'hours', duration)],
            [Utils.TIME_UNITS_['days'], _npgettext('after X day(s)', 'day',
                'days', duration)],
        ]);

        this._hctApotacComboBox.remove_all();

        time.forEach((label, i) => this._hctApotacComboBox
            .append(`${i}`, label));

        if (active !== null)
            this._hctApotacComboBox.set_active_id(active);
    }

    /**
     * Lists task lists and accounts of remote task lists.
     *
     * @param {boolean} accountsOnly - Only refresh the account list.
     * @param {boolean} [initRegistry] - Initialize the source registry.
     */
    async _listTaskListsAndAccounts(accountsOnly, initRegistry = false) {
        try {
            if (initRegistry) {
                this._sourceType = EDataServer.SOURCE_EXTENSION_TASK_LIST;
                this._sourceRegistry = await Utils.getSourceRegistry_(null);
                const customOrder = this._settings.get_strv('task-list-order');

                const customSort = customOrder.length ? Utils.customSort_.bind(
                    this, customOrder) : undefined;

                const sources = this._sourceRegistry.list_sources(
                    this._sourceType).sort(customSort);

                const clients = await Promise.all(sources.map(source =>
                    Utils.getECalClient_(source, ECal.ClientSourceType.TASKS,
                        1, null)));

                this._clients = new Map(clients.map(client =>
                    [client.source.uid, client]));
            }

            const accounts = new Map();

            for (const [, client] of this._clients) {
                const remote = client.check_refresh_supported();

                if (remote) {
                    // Account name (usually an email address):
                    const account = this._sourceRegistry.ref_source(
                        client.source.get_parent()).display_name;

                    // Keep an object of unique accounts:
                    if (!accounts.get(account)) {
                        accounts.set(account, this._sourceRegistry.ref_source(
                            client.source.get_parent()));
                    }
                }

                if (accountsOnly)
                    continue;

                const taskListRow = new TaskListRow(client,
                    this._sourceRegistry, remote, this._settings, this._window);

                if (Utils.shellVersionAtLeast_(40)) {
                    this._taskListBox.append(taskListRow);
                } else {
                    this._taskListBox.add(taskListRow);
                    taskListRow.show_all();
                }
            }

            if (!accounts.size) {
                this._backendRefreshButton.set_sensitive(false);

                this._backendRefreshButton.set_tooltip_text(
                    _('No remote task lists found'));

                if (accountsOnly)
                    return;
            } else {
                this._backendRefreshButton.set_sensitive(true);

                this._backendRefreshButton.set_tooltip_text(
                    _('Refresh the list of account task lists'));

                let action;
                const menu = Gio.Menu.new();
                const actionGroup = new Gio.SimpleActionGroup();

                for (const [account, source] of accounts) {
                    menu.append(account, `accounts.${account}`);
                    action = new Gio.SimpleAction({name: account});

                    action.connect('activate', () => {
                        this._onAccountButtonClicked(source, account);
                    });

                    actionGroup.add_action(action);
                }

                this._backendRefreshButton.set_menu_model(menu);

                this._backendRefreshButton.insert_action_group('accounts',
                    actionGroup);
            }

            if (accountsOnly)
                return;

            this._taskListAddedId = this._sourceRegistry.connect(
                'source-added', (_registry, source) => {
                    if (source.has_extension(this._sourceType))
                        this._onTaskListEvent('added', source);
                }
            );

            this._taskListRemovedId = this._sourceRegistry.connect(
                'source-removed', (_registry, source) => {
                    if (source.has_extension(this._sourceType))
                        this._onTaskListEvent('removed', source);
                }
            );

            this._taskListChangedId = this._sourceRegistry.connect(
                'source-changed', (_registry, source) => {
                    if (source.has_extension(this._sourceType))
                        this._onTaskListEvent('changed', source);
                }
            );
        } catch (e) {
            logError(e);
        }
    }

    /**
     * Handles account button click events.
     *
     * @param {EDataServer.SourceCollection} source - Account data source.
     * @param {string} account - Account name.
     */
    async _onAccountButtonClicked(source, account) {
        try {
            const extension = EDataServer.SOURCE_EXTENSION_COLLECTION;

            if (!source.has_extension(extension))
                throw new Error(`${account} is not refreshable`);

            // Refresh list of account task lists:
            if (!await Utils.refreshBackend_(this._sourceRegistry,
                source.uid, null))
                throw new Error(`${account} could not be refreshed`);

            this._backendRefreshButtonSpinner.set_tooltip_text(
                _('Refresh in progress') + Utils.ELLIPSIS_CHAR_);

            this._backendRefreshButton.set_visible(false);
            this._backendRefreshButtonSpinner.set_visible(true);

            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10,
                () => {
                    this._backendRefreshButton.set_visible(true);
                    this._backendRefreshButtonSpinner.set_visible(false);
                    return GLib.SOURCE_REMOVE;
                }
            );
        } catch (e) {
            logError(e);
        }
    }

    /**
     * Handles task list events (additions, removals and changes).
     *
     * @param {string} event - Type of event.
     * @param {EDataServer.Source} source - Associated data source.
     */
    async _onTaskListEvent(event, source) {
        try {
            let i = 0;
            let row = this._taskListBox.get_row_at_index(i);

            switch (event) {
                case 'added': {
                    const client = await Utils.getECalClient_(source,
                        ECal.ClientSourceType.TASKS, 1, null);

                    this._clients.set(source.uid, client);

                    const taskListRow = new TaskListRow(client,
                        this._sourceRegistry, client.check_refresh_supported(),
                        this._settings, this._window);

                    if (Utils.shellVersionAtLeast_(40)) {
                        this._taskListBox.append(taskListRow);
                    } else {
                        this._taskListBox.add(taskListRow);
                        taskListRow.show_all();
                    }

                    break;
                }

                case 'removed': {
                    this._clients.delete(source.uid);

                    while (row) {
                        if (row._uid === source.uid) {
                            if (Utils.shellVersionAtLeast_(40))
                                this._taskListBox.remove(row);
                            else
                                row.destroy();

                            break;
                        }

                        row = this._taskListBox.get_row_at_index(i++);
                    }

                    break;
                }

                case 'changed': {
                    while (row) {
                        if (row._uid === source.uid) {
                            row._taskListName.set_text(source.display_name);
                            break;
                        }

                        row = this._taskListBox.get_row_at_index(i++);
                    }
                }
            }

            // Refresh the list of accounts:
            this._listTaskListsAndAccounts(true);
        } catch (e) {
            logError(e);
        }
    }

    /**
     * Pads values of Gtk.SpinButton with zeros so that they always contain
     * two digits.
     *
     * @param {Gtk.SpinButton} button - Widget involved in the operation.
     * @returns {boolean} `true` to display the formatted value.
     */
    _timeOutput(button) {
        button.set_text(button.adjustment.value.toString().padStart(2, 0));
        return true;
    }

    /**
     * Disconnects signal handlers when settings window gets closed.
     */
    _onUnrealized() {
        if (this._taskListAddedId)
            this._sourceRegistry.disconnect(this._taskListAddedId);

        if (this._taskListRemovedId)
            this._sourceRegistry.disconnect(this._taskListRemovedId);

        if (this._taskListChangedId)
            this._sourceRegistry.disconnect(this._taskListChangedId);
    }

    /**
     * Adds a settings menu button to the header bar as soon as the widget gets
     * realized.
     *
     * @param {TaskWidgetSettings} widget - Widget that has been realized.
     */
    _onRealized(widget) {
        if (Utils.shellVersionAtLeast_(40)) {
            this._window = widget.get_root();
            const headerBar = new Gtk.HeaderBar({show_title_buttons: true});
            headerBar.pack_end(new SettingsMenuButton(this._window));
            headerBar.pack_end(new DonateMenuButton(this._window));
            this._window.set_titlebar(headerBar);
        } else {
            this._window = widget.get_toplevel();

            this._window._headerBar.pack_end(
                new SettingsMenuButton(this._window));

            this._window._headerBar.pack_end(
                new DonateMenuButton(this._window));

            this._window._headerBar.show_all();
        }
    }
});

const TaskListRow = GObject.registerClass({
    GTypeName: 'TaskListRow',
    Template: `resource://${Me.metadata.epath}/task-list-row${
        Utils.shellVersionAtLeast_(40) ? '' : '-gtk3'}.ui`,
    InternalChildren: [
        'taskListSwitch',
        'taskListName',
        'taskListProvider',
        'dragBox',
        'taskListOptionsButton',
        'taskListOptionsSpinner',
    ],
}, class TaskListRow extends Gtk.ListBoxRow {
    /**
     * Initializes a task list row.
     *
     * @param {ECal.Client} client - `ECal.Client` of the task list.
     * @param {EDataServer.SourceRegistry} registry - Source registry.
     * @param {boolean} remote - It's a remote task list.
     * @param {Gio.Settings} settings - API for storing and retrieving
     * extension settings.
     * @param {Gtk.Window} window - Extension settings window.
     */
    _init(client, registry, remote, settings, window) {
        super._init();
        const {source} = client;
        this._settings = settings;
        this._uid = source.uid;
        this._taskListName.set_text(source.display_name);

        this._taskListProvider.set_text(registry.ref_source(source.get_parent())
            .display_name);

        this._taskListSwitch.active = this._settings.get_strv(
            'disabled-task-lists').indexOf(source.uid) === -1;

        let action;
        const actionGroup = new Gio.SimpleActionGroup();
        action = new Gio.SimpleAction({name: 'up'});

        action.connect('activate', () => {
            this._moveRow(true);
        });

        actionGroup.add_action(action);
        action = new Gio.SimpleAction({name: 'down'});

        action.connect('activate', () => {
            this._moveRow(false);
        });

        actionGroup.add_action(action);

        if (remote) {
            const menu = this._taskListOptionsButton.menu_model;
            menu.append(_('Refresh Tasks'), 'options-menu.refresh');
            action = new Gio.SimpleAction({name: 'refresh'});

            action.connect('activate', () => {
                this._onRefreshButtonClicked(client);
            });

            actionGroup.add_action(action);
            menu.append(_('Properties'), 'options-menu.properties');
            action = new Gio.SimpleAction({name: 'properties'});

            action.connect('activate', () => {
                const dialog = new TaskListPropertiesDialog(window, source);
                dialog.present();
            });

            actionGroup.add_action(action);
            this._taskListOptionsButton.set_menu_model(menu);
        }

        this._taskListOptionsButton.insert_action_group('options-menu',
            actionGroup);

        this._taskListSwitch.connect('state-set', this._setTaskListState.bind(
            this, source));

        // Enable drag and drop operations:
        if (Utils.shellVersionAtLeast_(40)) {
            const dragSource = new Gtk.DragSource({
                actions: Gdk.DragAction.MOVE,
            });

            const dropTarget = new Gtk.DropTargetAsync({
                actions: Gdk.DragAction.MOVE,
            });

            this.add_controller(dropTarget);
            this.add_controller(dragSource);

            dragSource.connect('drag-begin', this._dragBegin.bind(this));
            dragSource.connect('drag-end', this._dragEnd.bind(this));

            dragSource.connect('prepare', (_sourceWidget, x, y) => {
                const taskListBox = this.get_parent();
                taskListBox.dragX = x;
                taskListBox.dragY = y;
                return new Gdk.ContentProvider(TaskListRow);
            });

            dropTarget.connect('drag-enter', () => {
                this.get_parent().drag_highlight_row(this);
            });

            dropTarget.connect('drag-leave', () => {
                this.get_parent().drag_unhighlight_row();
            });

            dropTarget.connect('drop', (_targetWidget, gdkDrop) => {
                const taskListBox = this.get_parent();
                const index = this.get_index();

                if (index === taskListBox.dragRow.get_index()) {
                    gdkDrop.read_value_async(TaskListRow, 1, null, () => {
                        gdkDrop.finish(Gdk.DragAction.MOVE);
                    });

                    return true;
                }

                taskListBox.remove(taskListBox.dragRow);
                taskListBox.insert(taskListBox.dragRow, index);
                this._updateTaskListOrder();

                gdkDrop.read_value_async(TaskListRow, 1, null, () => {
                    gdkDrop.finish(Gdk.DragAction.MOVE);
                });

                return true;
            });
        } else {
            this.drag_dest_set(Gtk.DestDefaults.ALL, [Gtk.TargetEntry.new(
                'Gtk.ListBoxRow', Gtk.TargetFlags.SAME_APP, 0)],
            Gdk.DragAction.MOVE);

            this.connect('drag-motion', () => {
                this.get_parent().dropRow = this;
            });

            this._dragBox.drag_source_set(Gdk.ModifierType.BUTTON1_MASK,
                [Gtk.TargetEntry.new('Gtk.ListBoxRow', Gtk.TargetFlags.SAME_APP,
                    0)], Gdk.DragAction.MOVE);

            this._dragBox.connect('drag-begin', this._dragBegin.bind(this));
            this._dragBox.connect('drag-end', this._dragEnd.bind(this));
        }
    }

    /**
     * Updates the task content of the task list when it's `Refresh Tasks`
     * button gets clicked.
     *
     * @param {ECal.Client} client - `ECal.Client` of the task list.
     */
    async _onRefreshButtonClicked(client) {
        try {
            this._taskListOptionsButton.set_visible(false);
            this._taskListOptionsSpinner.set_visible(true);

            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1,
                () => {
                    this._taskListOptionsButton.set_visible(true);
                    this._taskListOptionsSpinner.set_visible(false);
                    return GLib.SOURCE_REMOVE;
                }
            );

            if (!await Utils.refreshClient_(client, null)) {
                throw new Error('Cannot refresh the task list: ' +
                    client.source.display_name);
            }
        } catch (e) {
            logError(e);
        }
    }


    /**
     * Ensures that changes in task list order are saved in settings.
     */
    _updateTaskListOrder() {
        let i = 0;
        const uids = [];
        const taskListBox = this.get_parent();
        let row = taskListBox.get_row_at_index(i);

        while (row) {
            uids.push(row._uid);
            row = taskListBox.get_row_at_index(i++);
        }

        this._settings.set_strv('task-list-order', uids);
    }

    /**
     * Moves the row up or down in the list of task lists.
     *
     * @param {boolean} up - Move the row upwards.
     */
    _moveRow(up) {
        let index = this.get_index();
        const taskListBox = this.get_parent();
        taskListBox.remove(this);

        if (up)
            --index;
        else if (taskListBox.get_row_at_index(index))
            ++index;
        else
            index = 0;

        taskListBox.insert(this, index);
        this._updateTaskListOrder();
    }

    /**
     * Initializes the drag and drop operation.
     *
     * @param {*} widget - Widget involved in the operation.
     * @param {Gdk.DragContext} context - Drag context.
     */
    _dragBegin(widget, context) {
        this.get_style_context().add_class('drag-icon');
        const taskListBox = this.get_parent();
        taskListBox.dragRow = this;

        if (Utils.shellVersionAtLeast_(40)) {
            widget.set_icon(Gtk.WidgetPaintable.new(this), taskListBox.dragX,
                taskListBox.dragY);
        } else {
            const allocation = this.get_allocation();

            const imageSurface = new Cairo.ImageSurface(Cairo.Format.ARGB32,
                allocation.width, allocation.height);

            const cairoContext = new Cairo.Context(imageSurface);
            this.draw(cairoContext);
            Gtk.drag_set_icon_surface(context, imageSurface);
            cairoContext.$dispose();
        }
    }

    /**
     * Finalizes the drag and drop operation.
     */
    _dragEnd() {
        this.get_style_context().remove_class('drag-icon');
        const taskListBox = this.get_parent();

        if (Utils.shellVersionAtLeast_(40)) {
            taskListBox.drag_unhighlight_row();
        } else {
            const dropIndex = taskListBox.dropRow.get_index();

            if (taskListBox.dragRow.get_index() === dropIndex)
                return;

            taskListBox.remove(taskListBox.dragRow);
            taskListBox.insert(taskListBox.dragRow, dropIndex);
            this._updateTaskListOrder();
            delete taskListBox.dragRow;
            delete taskListBox.dropRow;
        }
    }

    /**
     * Adds or removes the task list from the list of disabled task lists.
     *
     * @param {EDataServer.Source} source - Source of the task list.
     * @param {Gtk.Switch} _widget - Switch whose state is handled.
     * @param {boolean} enabled - Switch is in its enabled state.
     */
    _setTaskListState(source, _widget, enabled) {
        const disabled = this._settings.get_strv('disabled-task-lists');

        if (enabled) {
            const index = disabled.indexOf(source.uid);

            if (index !== -1)
                disabled.splice(index, 1);
        } else {
            disabled.push(source.uid);
        }

        this._settings.set_strv('disabled-task-lists', disabled);
    }
});

const TaskListPropertiesDialog = GObject.registerClass({
    GTypeName: 'TaskListPropertiesDialog',
    Template: `resource://${Me.metadata.epath}/task-list-properties-dialog${
        Utils.shellVersionAtLeast_(40) ? '' : '-gtk3'}.ui`,
    InternalChildren: [
        'taskListPropertiesDialogComboBox',
        'taskListPropertiesDialogSpinButton',
    ],
}, class TaskListPropertiesDialog extends Gtk.Dialog {
    /**
     * Initializes a dialog for task list properties.
     *
     * @param {Gtk.Window} window - Extension settings window.
     * @param {EDataServer.Source} source - Source of the task list.
     */
    _init(window, source) {
        super._init();
        this.set_transient_for(window);
        this.set_title(`${this.get_title()} — ${source.display_name}`);
        this._source = source;

        this._extension = source.get_extension(
            EDataServer.SOURCE_EXTENSION_REFRESH);

        let units;
        let interval = this._extension.interval_minutes;

        if (interval === 0) {
            units = Utils.TIME_UNITS_['minutes'];
        } else if (interval % Utils.MINUTES_PER_DAY_ === 0) {
            interval /= Utils.MINUTES_PER_DAY_;
            units = Utils.TIME_UNITS_['days'];
        } else if (interval % Utils.MINUTES_PER_HOUR_ === 0) {
            interval /= Utils.MINUTES_PER_HOUR_;
            units = Utils.TIME_UNITS_['hours'];
        } else {
            units = Utils.TIME_UNITS_['minutes'];
        }

        this._fillTimeUnitComboBox(interval, `${units}`);
        this._taskListPropertiesDialogSpinButton.set_value(interval);

        this._taskListPropertiesDialogSpinButton.connect('value-changed',
            button => this._fillTimeUnitComboBox(button.value));
    }

    /**
     * Fills Gtk.ComboBox with time units.
     *
     * @param {number} interval - Time interval used to update the task list.
     * @param {string} [active] - ID of the active Gtk.ComboBox item.
     */
    _fillTimeUnitComboBox(interval, active = null) {
        const time = new Map([
            [Utils.TIME_UNITS_['minutes'], _npgettext(
                'refresh every X minutes(s)', 'minute', 'minutes', interval)],
            [Utils.TIME_UNITS_['hours'], _npgettext(
                'refresh every X hour(s)', 'hour', 'hours', interval)],
            [Utils.TIME_UNITS_['days'], _npgettext(
                'refresh every X day(s)', 'day', 'days', interval)],
        ]);

        const comboBox = this._taskListPropertiesDialogComboBox;
        active = active !== null ? active : comboBox.active_id;
        comboBox.remove_all();
        time.forEach((label, i) => comboBox.append(`${i}`, label));
        comboBox.set_active_id(active);
    }

    /**
     * Handles closing of the dialog.
     *
     * @param {Gtk.ResponseType} id - Response type id returned after closing
     * the dialog.
     */
    vfunc_response(id) {
        if (id === Gtk.ResponseType.OK) {
            const active = this._taskListPropertiesDialogComboBox.active_id;
            let interval = this._taskListPropertiesDialogSpinButton.value;

            switch (parseInt(active)) {
                case Utils.TIME_UNITS_['hours']:
                    interval *= Utils.MINUTES_PER_HOUR_;
                    break;
                case Utils.TIME_UNITS_['days']:
                    interval *= Utils.MINUTES_PER_DAY_;
            }

            this._extension.set_interval_minutes(interval);
            this._source.write_sync(null);
        }

        this.destroy();
    }
});

const SettingsMenuButton = GObject.registerClass({
    GTypeName: 'SettingsMenuButton',
    Template: `resource://${Me.metadata.epath}/settings-menu${
        Utils.shellVersionAtLeast_(40) ? '' : '-gtk3'}.ui`,
    InternalChildren: [
        'aboutDialog',
        'supportLogDialog',
    ],
}, class SettingsMenuButton extends Gtk.MenuButton {
    /**
     * Initializes the settings menu.
     *
     * @todo xgettext cannot extract translatable strings from JSON files yet,
     * therefore extension name and description in the "About" dialog will
     * not be translated.
     *
     * @param {Gtk.Window} window - Extension settings window.
     */
    _init(window) {
        super._init();
        const {modal} = window;
        this._aboutDialog.transient_for = window;
        this._aboutDialog.program_name = _(Me.metadata.name);
        this._aboutDialog.version = Me.metadata.version.toString();
        this._aboutDialog.website = Me.metadata.url;
        this._aboutDialog.comments = _(Me.metadata.description);

        this._aboutDialog.translator_credits =
            /* Translators: put down your name/nickname and email (optional)
            according to the format below. This will credit you in the "About"
            window of the extension settings. */
            Gettext.pgettext('translator name <email>', 'translator-credits');

        const actionGroup = new Gio.SimpleActionGroup();
        let action = new Gio.SimpleAction({name: 'log'});

        action.connect('activate', () => {
            this._supportLogDialog._time =
                GLib.DateTime.new_now_local().format('%F %T');

            if (modal)
                window.set_modal(false);

            this._supportLogDialog.present();
            this.set_sensitive(false);
        });

        actionGroup.add_action(action);
        action = new Gio.SimpleAction({name: 'wiki'});

        action.connect('activate', () => {
            Gio.AppInfo.launch_default_for_uri_async(Me.metadata.wiki,
                null, null, null);
        });

        actionGroup.add_action(action);
        action = new Gio.SimpleAction({name: 'about'});

        action.connect('activate', () => {
            this._aboutDialog.present();
        });

        actionGroup.add_action(action);
        this.insert_action_group('settings-menu', actionGroup);

        if (Utils.shellVersionAtLeast_(40)) {
            this._aboutDialog.connect('close-request', () => {
                this._aboutDialog.hide();
            });
        } else {
            this._aboutDialog.connect('delete-event', () => {
                this._aboutDialog.hide();
                return true;
            });
        }

        this._supportLogDialog.connect('response', (dialog, response) => {
            if (response === Gtk.ResponseType.OK)
                this._generateSupportLog(dialog._time);

            if (modal)
                window.set_modal(true);

            this.set_sensitive(true);
            dialog._time = null;
            dialog.hide();
        });
    }

    /**
     * Generates the support log. User is notified to remove or censor any
     * information he/she considers to be private.
     *
     * @author Andy Holmes <andrew.g.r.holmes@gmail.com> (the original code was
     * extended to include more data).
     * @param {GLib.DateTime} time - Restricts log entries displayed to those
     * after this time.
     */
    async _generateSupportLog(time) {
        try {
            const gschema = id => new Gio.Settings({
                settings_schema: Gio.SettingsSchemaSource.get_default()
                    .lookup(id, true),
            });

            const [file, stream] = Gio.File.new_tmp('taskwidget.XXXXXX');
            const logFile = stream.get_output_stream();
            const widgetName = `${Me.metadata.name} v${Me.metadata.version}`;

            const iconTheme = gschema('org.gnome.desktop.interface')
                .get_string('icon-theme');

            const gtkTheme = gschema('org.gnome.desktop.interface')
                .get_string('gtk-theme');

            const userType = Me.metadata.locale === 'user-specific' ? 'user'
                : 'system';

            let shellTheme;

            try {
                shellTheme = gschema('org.gnome.shell.extensions.user-theme')
                    .get_string('name');

                if (!shellTheme)
                    throw new Error();
            } catch (e) {
                shellTheme = 'Adwaita (default)';
            }

            const monitors = Utils.shellVersionAtLeast_(40)
                ? Gdk.Display.get_default().get_monitors()
                : Gdk.Display.get_default();

            const total = Utils.shellVersionAtLeast_(40)
                ? monitors.get_n_items()
                : monitors.get_n_monitors();

            let display = '';

            for (let i = 0; i < total; i++) {
                const item = Utils.shellVersionAtLeast_(40)
                    ? monitors.get_item(i)
                    : monitors.get_monitor(i);

                display += item.geometry.width * item.scale_factor + 'x' +
                    item.geometry.height * item.scale_factor + '@' +
                    item.scale_factor + 'x';

                if (i !== total - 1)
                    display += ', ';
            }

            const logHeader = widgetName + ' (' + userType + ')\n' +
                GLib.get_os_info('PRETTY_NAME') + '\n' +
                'GNOME Shell ' + imports.misc.config.PACKAGE_VERSION + '\n' +
                'gjs ' + imports.system.version + '\n' +
                'Language: ' + GLib.getenv('LANG') + '\n' +
                'XDG Session Type: ' + GLib.getenv('XDG_SESSION_TYPE') + '\n' +
                'GDM Session Type: ' + GLib.getenv('GDMSESSION') + '\n' +
                'Shell Theme: ' + shellTheme + '\n' +
                'Icon Theme: ' + iconTheme + '\n' +
                'GTK Theme: ' + gtkTheme + '\n' +
                'Display: ' + display + '\n\n';

            await Utils.writeBytesAsync_(logFile, new GLib.Bytes(logHeader), 0,
                null);

            const process = new Gio.Subprocess({
                flags: Gio.SubprocessFlags.STDOUT_PIPE |
                       Gio.SubprocessFlags.STDERR_MERGE,
                argv: ['journalctl', '--no-host', '--since', time],
            });

            process.init(null);

            logFile.splice_async(process.get_stdout_pipe(),
                Gio.OutputStreamSpliceFlags.CLOSE_TARGET, GLib.PRIORITY_DEFAULT,
                null, (source, result) => {
                    try {
                        source.splice_finish(result);
                    } catch (e) {
                        logError(e);
                    }
                }
            );

            await Utils.waitCheckAsync_(process, null);

            Gio.AppInfo.launch_default_for_uri_async(file.get_uri(), null,
                null, null);
        } catch (e) {
            logError(e);
        }
    }
});

const DonateMenuButton = GObject.registerClass({
    GTypeName: 'DonateMenuButton',
    Template: `resource://${Me.metadata.epath}/donate-menu${
        Utils.shellVersionAtLeast_(40) ? '' : '-gtk3'}.ui`,
    InternalChildren: [
        'donateCrypto',
        'donateOptionsComboBox',
        'donateOptionsStack',
    ],
}, class DonateMenuButton extends Gtk.MenuButton {
    /**
     * Initializes the donations menu.
     *
     * @param {Gtk.Window} window - Extension settings window.
     */
    _init(window) {
        super._init();
        const actionGroup = new Gio.SimpleActionGroup();
        let action = new Gio.SimpleAction({name: 'coffee'});

        action.connect('activate', () => {
            Gio.AppInfo.launch_default_for_uri_async(Me.metadata.coffee,
                null, null, null);
        });

        actionGroup.add_action(action);
        action = new Gio.SimpleAction({name: 'paypal'});

        action.connect('activate', () => {
            Gio.AppInfo.launch_default_for_uri_async(Me.metadata.paypal,
                null, null, null);
        });

        actionGroup.add_action(action);
        action = new Gio.SimpleAction({name: 'liberapay'});

        action.connect('activate', () => {
            Gio.AppInfo.launch_default_for_uri_async(Me.metadata.liberapay,
                null, null, null);
        });

        actionGroup.add_action(action);
        action = new Gio.SimpleAction({name: 'crypto'});

        action.connect('activate', () => {
            this._donateCrypto.set_transient_for(window);

            if (Utils.shellVersionAtLeast_(40))
                this._donateCrypto.show();
            else
                this._donateCrypto.show_all();
        });

        actionGroup.add_action(action);
        this.insert_action_group('donate-menu', actionGroup);

        if (!Utils.shellVersionAtLeast_(40)) {
            this._donateCrypto.connect('delete-event', () => {
                this._donateCrypto.hide();
                return true;
            });
        }

        this._donateOptionsComboBox.connect('changed', option => {
            switch (option.active_id) {
                case 'bitcoin':
                    this._donateOptionsStack.set_visible_child_name(
                        'donateBitcoinPage');

                    break;
                case 'bitcoin-cash':
                    this._donateOptionsStack.set_visible_child_name(
                        'donateBitcoinCashPage');

                    break;
                case 'ethereum':
                    this._donateOptionsStack.set_visible_child_name(
                        'donateEthereumPage');
            }
        });
    }
});

