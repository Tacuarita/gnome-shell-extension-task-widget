'use strict';

const {Gdk, Gio, GLib, GObject, Gtk} = imports.gi;

const Cairo = imports.cairo;
const Gettext = imports.gettext;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;

const Adw = Utils.shellVersionAtLeast_(42) ? imports.gi.Adw : undefined;

/* exported ICalGLib */
const {ECal, EDataServer, ICalGLib} = Utils.HAS_EDS_ ? imports.gi : {undefined};
const _ = Gettext.gettext;

/**
 * Enables the use of context in translation of plurals.
 *
 * @param {string} context - Context for the translation.
 * @param {string} singular - Singular of the translatable string.
 * @param {string} plural - Plural of the translatable string.
 * @param {number} n - Number to apply the plural formula to.
 *
 * @returns {string} Translated string.
 */
const _npgettext = (context, singular, plural, n) => {
    if (n !== 1)
        return Gettext.ngettext(`${context}\u0004${singular}`, plural, n);
    else
        return Gettext.pgettext(context, singular);
};

let _resource = null;

/**
 * (Re)loads UI as a resource file.
 */
const _loadResource = () => {
    if (_resource)
        return;

    const resourcePath = GLib.build_filenamev([Me.dir.get_path(),
        Me.metadata.gresource]);

    _resource = Gio.Resource.load(resourcePath);
    Gio.resources_register(_resource);
};

/**
 * Generates paths to UI files available in a resource file.
 *
 * @param {string} file - Filename of a UI file.
 *
 * @returns {string} Path to UI file in a resource file.
 */
const _templatePath = file => {
    let suffix = '';

    if (Utils.shellVersionAtLeast_(42))
        suffix = '';
    else if (Utils.shellVersionAtLeast_(40))
        suffix = '-gtk4';
    else
        suffix = '-gtk3';

    return `resource://${Me.metadata.epath}/${file + suffix}.ui`;
};

_loadResource();

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
 * @returns {Gtk.ScrolledWindow|Adw.PreferencesPage} The settings widget.
 */
function buildPrefsWidget() {
    _loadResource();

    if (Utils.shellVersionAtLeast_(42))
        return Utils.HAS_EDS_ ? new TaskWidgetSettings() : new BeGoneWidget();

    const widget = Gtk.Window.list_toplevels().filter(win => win._uuid &&
        win._uuid === Me.uuid).length === 1 && Utils.HAS_EDS_
        ? new TaskWidgetSettings() : new BeGoneWidget();

    const scrolledWindow = new Gtk.ScrolledWindow();

    if (Utils.shellVersionAtLeast_(40)) {
        scrolledWindow.set_child(widget);
    } else {
        scrolledWindow.add(widget);
        scrolledWindow.show_all();
    }

    scrolledWindow.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
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
    Template: _templatePath('settings-window'),
    InternalChildren: [
        'mtlSwitch',
        'gptSwitch',
        'hhfstlSwitch',
        'heactlSwitch',
        'socRow',
        'socSwitch',
        'taskCategoryPast',
        'taskCategoryToday',
        'taskCategoryTomorrow',
        'taskCategoryNextSevenDays',
        'taskCategoryScheduled',
        'taskCategoryNotCancelled',
        'taskCategoryStarted',
        'hctRow',
        'hctComboBox',
        'hctSettingsStack',
        'hctApotacComboBox',
        'hctApotacSpinButton',
        'hctAstodSpinButtonHour',
        'hctAstodSpinButtonMinute',
        'backendRefreshButton',
        'backendRefreshButtonSpinner',
        'taskListBox',
    ].concat(!Utils.shellVersionAtLeast_(42) ? [
        'socSettingsRevealer',
        'hctSettingsRevealer',
    ] : []),
}, class TaskWidgetSettings extends (Utils.shellVersionAtLeast_(42)
    ? Adw.PreferencesPage : Gtk.Box) {
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

        if (Utils.shellVersionAtLeast_(42)) {
            [this._socRow, this._hctRow].forEach(row => this._findChildWidget(
                'styleClass', row, 'expander-row-arrow').hide());
        }

        const dir = Me.metadata.schemas === 'user-specific'
            ? Me.dir.get_child('schemas').get_path() : Me.metadata.schemas;

        const gschema = Gio.SettingsSchemaSource.new_from_directory(
            dir, Gio.SettingsSchemaSource.get_default(), false);

        this._settings = new Gio.Settings({
            settings_schema: gschema.lookup(Me.metadata.base, true),
        });

        this._hctComboBox.connect('changed', option => {
            const expanded = option.active > 1;

            if (!Utils.shellVersionAtLeast_(42)) {
                this._hctSettingsRevealer.set_reveal_child(expanded);
            } else {
                this._hctRow.set_enable_expansion(expanded);
                this._hctRow.set_expanded(expanded);
            }

            switch (option.active) {
                case Utils.HIDE_COMPLETED_TASKS_['after-time-period']: {
                    this._hctSettingsStack.set_visible_child_name(
                        'hctApotacPage');

                    break;
                }

                case Utils.HIDE_COMPLETED_TASKS_['after-specified-time']: {
                    this._hctSettingsStack.set_visible_child_name(
                        'hctAstodPage');
                }
            }
        });

        [
            ['merge-task-lists', this._mtlSwitch],
            ['group-past-tasks', this._gptSwitch],
            ['hide-header-for-singular-task-lists', this._hhfstlSwitch],
            ['hide-empty-completed-task-lists', this._heactlSwitch],
            ['hide-completed-tasks', this._hctComboBox],
            ['show-only-selected-categories', this._socSwitch],
            ['hct-apotac-value', this._hctApotacSpinButton, 'value'],
            ['hct-apotac-unit', this._hctApotacComboBox],
            ['hct-astod-hour', this._hctAstodSpinButtonHour, 'value'],
            ['hct-astod-minute', this._hctAstodSpinButtonMinute, 'value'],
        ].forEach(([key, object, property = 'active',
            flags = Gio.SettingsBindFlags.DEFAULT]) =>
            this._settings.bind(key, object, property, flags));

        const selected = this._settings.get_strv('selected-task-categories');

        [
            this._taskCategoryPast,
            this._taskCategoryToday,
            this._taskCategoryTomorrow,
            this._taskCategoryNextSevenDays,
            this._taskCategoryScheduled,
            this._taskCategoryNotCancelled,
            this._taskCategoryStarted,
        ].forEach(category => category.set_active(selected.includes(
            category.name)));

        [
            [this._taskCategoryPast, this._taskCategoryScheduled],
            [this._taskCategoryToday, this._taskCategoryNextSevenDays],
            [this._taskCategoryToday, this._taskCategoryScheduled],
            [this._taskCategoryTomorrow, this._taskCategoryNextSevenDays],
            [this._taskCategoryTomorrow, this._taskCategoryScheduled],
            [this._taskCategoryNextSevenDays, this._taskCategoryScheduled],
        ].forEach(([source, target]) =>
            source.bind_property_full('active', target, 'active',
                GObject.BindingFlags.BIDIRECTIONAL,
                value => {
                    if (value.source.active) {
                        value.target.set_active(false);
                        return [true];
                    }

                    return [false];
                },

                value => {
                    if (value.target.active) {
                        value.source.set_active(false);
                        return [true];
                    }

                    return [false];
                })
        );

        if (!Utils.shellVersionAtLeast_(40)) {
            this._taskListBox.set_header_func((row, before) => {
                if (!before || row.get_header())
                    return;

                row.set_header(new Gtk.Separator({
                    orientation: Gtk.Orientation.HORIZONTAL,
                }));
            });

            this._taskCategoryScheduled.set_sensitive(false);
            this._taskCategoryStarted.set_sensitive(false);
        }

        this._listTaskListsAndAccounts();
    }

    /**
     * Recursively traverses the widget tree below the given parent and returns
     * the first widget whose given property matches the given value.
     *
     * @param {string} property - Look for a child with this property.
     * @param {*} parent - Parent of the child to be searched.
     * @param {*} value - Value of the given property.
     *
     * @returns {*|null} Child that meets the criteria or `null`.
     */
    _findChildWidget(property, parent, value) {
        let match;

        for (const child of [...parent]) {
            switch (property) {
                case 'type': {
                    if (child instanceof value)
                        return child;

                    break;
                }

                case 'styleClass': {
                    if (child.get_css_classes().includes(value))
                        return child;
                }
            }

            match = this._findChildWidget(property, child, value);

            if (match)
                return match;
        }

        return null;
    }

    /**
     * Handles click events for task category checkbuttons.
     *
     * @param {Gtk.CheckButton} button - Corresponding checkbutton.
     */
    _toggleTaskCategory(button) {
        const selection = this._settings.get_strv('selected-task-categories');

        if (!button.active)
            selection.splice(selection.indexOf(button.name), 1);
        else if (!selection.includes(button.name))
            selection.push(button.name);

        this._settings.set_strv('selected-task-categories', selection);
    }

    /**
     * Fills "After a period of time after completion" Gtk.ComboBox with
     * time units.
     *
     * @param {Gtk.SpinButton} button - Corresponding `Gtk.SpinButton` that
     * sets time units.
     */
    _fillApotacComboBox(button) {
        const active = this._hctApotacComboBox.active_id;
        const duration = button.get_value();

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
     * @async
     * @param {boolean} [accountsOnly] - Only refresh the account list.
     */
    async _listTaskListsAndAccounts(accountsOnly = false) {
        try {
            if (!accountsOnly)
                await this._initRegistry();

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

                const taskListRow = new TaskListRow(client, remote, this);

                if (Utils.shellVersionAtLeast_(40))
                    this._taskListBox.append(taskListRow);
                else
                    this._taskListBox.add(taskListRow);
            }

            if (!accounts.size) {
                this._backendRefreshButton.set_sensitive(false);

                this._backendRefreshButton.set_tooltip_text(
                    _('No remote task lists found'));
            } else {
                this._backendRefreshButton.set_tooltip_text(
                    _('Refresh the list of account task lists'));

                let i = 0;
                let action;
                const menu = Gio.Menu.new();
                const actionGroup = new Gio.SimpleActionGroup();

                for (const [account, source] of accounts) {
                    menu.append(account, `accounts.${i}`);
                    action = new Gio.SimpleAction({name: `${i}`});

                    action.connect('activate', () =>
                        this._onAccountButtonClicked(source, account));

                    actionGroup.add_action(action);
                    i++;
                }

                this._backendRefreshButton.set_menu_model(menu);

                this._backendRefreshButton.insert_action_group('accounts',
                    actionGroup);
            }
        } catch (e) {
            logError(e);
        }
    }

    /**
     * Initializes the source registry.
     *
     * @async
     */
    async _initRegistry() {
        try {
            const sourceType = EDataServer.SOURCE_EXTENSION_TASK_LIST;
            this._sourceRegistry = await Utils.getSourceRegistry_();
            const customOrder = this._settings.get_strv('task-list-order');

            const customSort = customOrder.length ? Utils.customSort_.bind(
                this, customOrder) : undefined;

            const sources = this._sourceRegistry.list_sources(
                sourceType).sort(customSort);

            const clients = await Promise.all(sources.map(source =>
                Utils.getECalClient_(source, ECal.ClientSourceType.TASKS,
                    1, null)));

            this._clients = new Map(clients.map(client =>
                [client.source.uid, client]));

            this._taskListAddedId = this._sourceRegistry.connect(
                'source-added', (_self, source) => {
                    if (source.has_extension(sourceType))
                        this._onTaskListEvent('added', source);
                }
            );

            this._taskListRemovedId = this._sourceRegistry.connect(
                'source-removed', (_self, source) => {
                    if (source.has_extension(sourceType))
                        this._onTaskListEvent('removed', source);
                }
            );

            this._taskListChangedId = this._sourceRegistry.connect(
                'source-changed', (_self, source) => {
                    if (source.has_extension(sourceType))
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
     * @async
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

            this._backendRefreshId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT, 5, () => {
                    this._backendRefreshButton.set_visible(true);
                    this._backendRefreshButtonSpinner.set_visible(false);
                    delete this._backendRefreshId;
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
     * @async
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
                        client.check_refresh_supported(), this);

                    if (Utils.shellVersionAtLeast_(40))
                        this._taskListBox.append(taskListRow);
                    else
                        this._taskListBox.add(taskListRow);

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
                            if (Utils.shellVersionAtLeast_(42))
                                row.set_title(source.display_name);
                            else
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
     *
     * @returns {boolean} `true` to display the formatted value.
     */
    _timeOutput(button) {
        button.set_text(button.adjustment.value.toString().padStart(2, 0));
        return true;
    }

    /**
     * Disconnects signal handlers and unregisters resources when settings
     * window gets closed.
     */
    _onUnrealized() {
        if (this._taskListAddedId)
            this._sourceRegistry.disconnect(this._taskListAddedId);

        if (this._taskListRemovedId)
            this._sourceRegistry.disconnect(this._taskListRemovedId);

        if (this._taskListChangedId)
            this._sourceRegistry.disconnect(this._taskListChangedId);

        if (this._backendRefreshId)
            GLib.source_remove(this._backendRefreshId);

        Gio.resources_unregister(_resource);
        _resource = null;
    }

    /**
     * Adds custom buttons to the header bar as soon as the widget gets
     * realized.
     *
     * @param {TaskWidgetSettings} widget - Widget that has been realized.
     */
    _onRealized(widget) {
        this._window = Utils.shellVersionAtLeast_(40) ? widget.get_root()
            : widget.get_toplevel();

        const headerBar = Utils.shellVersionAtLeast_(42)
            ? this._findChildWidget('type', this._window, Adw.HeaderBar)
            : this._window.get_titlebar();

        headerBar.pack_end(new SettingsMenuButton(this));
        headerBar.pack_end(new DonateMenuButton(this));

        if (!Utils.shellVersionAtLeast_(40))
            headerBar.show_all();
    }
});

const TaskListRow = GObject.registerClass({
    GTypeName: 'TaskListRow',
    Template: _templatePath('task-list-row'),
    InternalChildren: [
        'taskListProvider',
        'taskListSwitch',
        'taskListOptionsButton',
        'taskListOptionsSpinner',
    ].concat(!Utils.shellVersionAtLeast_(42) ? ['taskListName'] : [])
     .concat(!Utils.shellVersionAtLeast_(40) ? ['dragBox'] : []),
}, class TaskListRow extends (Utils.shellVersionAtLeast_(42)
    ? Adw.ActionRow : Gtk.ListBoxRow) {
    /**
     * Initializes a task list row.
     *
     * @param {ECal.Client} client - `ECal.Client` of the task list.
     * @param {boolean} remote - It's a remote task list.
     * @param {TaskWidgetSettings} widget - Reference to the main widget class.
     */
    _init(client, remote, widget) {
        super._init();
        this._source = client.source;
        this._settings = widget._settings;
        this._uid = this._source.uid;

        if (Utils.shellVersionAtLeast_(42))
            this.set_title(this._source.display_name);
        else
            this._taskListName.set_text(this._source.display_name);

        this._taskListProvider.set_text(widget._sourceRegistry.ref_source(
            this._source.get_parent()).display_name);

        this._taskListSwitch.active = this._settings.get_strv(
            'disabled-task-lists').indexOf(this._source.uid) === -1;

        let action;
        const actionGroup = new Gio.SimpleActionGroup();
        action = new Gio.SimpleAction({name: 'up'});
        action.connect('activate', () => this._moveRow(true));
        actionGroup.add_action(action);
        action = new Gio.SimpleAction({name: 'down'});
        action.connect('activate', () => this._moveRow(false));
        actionGroup.add_action(action);

        if (remote) {
            const menu = this._taskListOptionsButton.menu_model;
            menu.append(_('Refresh Tasks'), 'options-menu.refresh');
            action = new Gio.SimpleAction({name: 'refresh'});

            action.connect('activate', () =>
                this._onRefreshButtonClicked(client));

            actionGroup.add_action(action);
            menu.append(_('Properties'), 'options-menu.properties');
            action = new Gio.SimpleAction({name: 'properties'});

            action.connect('activate', () =>
                new TaskListPropertiesDialog(widget, this._source).present());

            actionGroup.add_action(action);
            this._taskListOptionsButton.set_menu_model(menu);
        }

        this._taskListOptionsButton.insert_action_group('options-menu',
            actionGroup);

        // Set up drag and drop operations:
        if (!Utils.shellVersionAtLeast_(40)) {
            const targets = [Gtk.TargetEntry.new('Gtk.ListBoxRow',
                Gtk.TargetFlags.SAME_APP, 0)];

            this._dragBox.drag_source_set(Gdk.ModifierType.BUTTON1_MASK,
                targets, Gdk.DragAction.MOVE);

            this.drag_dest_set(Gtk.DestDefaults.ALL, targets,
                Gdk.DragAction.MOVE);
        }
    }

    /**
     * Handles motion events for GTK3 widgets.
     *
     * @param {*} widget - Widget participating in the motion event.
     * @param {Gdk.Event} event - Associated `Gdk.Event`.
     *
     * @returns {Gdk.EVENT_PROPAGATE} `false` to continue propagation of an
     * event handler.
     */
    _onMotionEventLegacy(widget, event) {
        let cursor;

        const reactive = widget instanceof Gtk.Switch ||
            widget instanceof Gtk.MenuButton;

        if (event.get_event_type() === Gdk.EventType.ENTER_NOTIFY)
            cursor = reactive ? 'default' : 'grab';
        else
            cursor = reactive ? 'grab' : 'default';

        this.get_window().set_cursor(Gdk.Cursor.new_from_name(
            this.get_window().get_display(), cursor));

        return Gdk.EVENT_PROPAGATE;
    }

    /**
     * Handles motion events for GTK4 widgets.
     *
     * @param {Gtk.EventControllerMotion} controller - Event controller.
     * @param {number} x - The X coordinate.
     */
    _onMotionEvent(controller, x) {
        let cursor;

        const reactive = controller.widget instanceof Gtk.Switch ||
            controller.widget instanceof Gtk.MenuButton;

        if (x !== undefined)
            cursor = reactive ? 'default' : 'grab';
        else
            cursor = reactive ? 'grab' : 'default';

        this.get_root().set_cursor(Gdk.Cursor.new_from_name(cursor, null));
    }


    /**
     * Updates the task content of the task list when it's `Refresh Tasks`
     * button gets clicked.
     *
     * @async
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
     * Prepares drag and drop operations.
     *
     * @param {*} y - the Y coordinate of the drag starting point.
     * @param {*} x - the X coordinate of the drag starting point.
     *
     * @returns {Gdk.ContentProvider} Type of content to provide in drag and
     * drop operations.
     */
    _dragPrepare(y, x) {
        const taskListBox = this.get_parent();
        taskListBox.dragX = x;
        taskListBox.dragY = y;
        return Gdk.ContentProvider.new_for_value(this);
    }

    /**
     * Initializes drag and drop operations.
     *
     * @param {Gtk.EventBox|Gtk.DragSource} source - `Gtk.EventBox` or
     * `Gtk.DragSource` when either GTK3 or GTK4 is used.
     * @param {Gdk.DragContext|Gdk.Drag} context - `Gdk.DragContext` or
     * `Gdk.Drag` when either GTK3 or GTK4 is used.
     */
    _dragBegin(source, context) {
        this.get_style_context().add_class('drag-icon');
        const taskListBox = this.get_parent();

        if (Utils.shellVersionAtLeast_(40)) {
            source.set_icon(Gtk.WidgetPaintable.new(this), taskListBox.dragX,
                taskListBox.dragY);
        } else {
            taskListBox._dragRow = this;
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
     * Handles the `drop` part of a drag and drop operation.
     *
     * @param {TaskListRow|Gtk.DropTarget} target - `TaskListRow` receiving the
     * drop or `Gtk.DropTarget` when either GTK3 or GTK4 is used.
     */
    _dragDrop(target) {
        const taskListBox = this.get_parent();

        const dropIndex = Utils.shellVersionAtLeast_(40) ? this.get_index()
            : target.get_index();

        const dragRow = Utils.shellVersionAtLeast_(40) ? target.value
            : taskListBox._dragRow;

        if (dropIndex === dragRow.get_index())
            return false;

        taskListBox.remove(dragRow);
        taskListBox.insert(dragRow, dropIndex);
        this._updateTaskListOrder();
        return true;
    }

    /**
     * Finalizes the drag and drop operation.
     */
    _dragEnd() {
        this.get_style_context().remove_class('drag-icon');
    }

    /**
     * Adds or removes the task list from the list of disabled task lists.
     *
     * @param {Gtk.Switch} widget - Switch whose state is handled.
     */
    _setTaskListState(widget) {
        const disabled = this._settings.get_strv('disabled-task-lists');

        if (widget.active) {
            const index = disabled.indexOf(this._source.uid);

            if (index !== -1)
                disabled.splice(index, 1);
        } else {
            disabled.push(this._source.uid);
        }

        this._settings.set_strv('disabled-task-lists', disabled);
    }
});

const TaskListPropertiesDialog = GObject.registerClass({
    GTypeName: 'TaskListPropertiesDialog',
    Template: _templatePath('task-list-properties-dialog'),
    InternalChildren: [
        'taskListPropertiesDialogComboBox',
        'taskListPropertiesDialogSpinButton',
    ],
}, class TaskListPropertiesDialog extends Gtk.Dialog {
    /**
     * Initializes a dialog for task list properties.
     *
     * @param {TaskWidgetSettings} widget - Reference to the main widget class.
     * @param {EDataServer.Source} source - Source of the task list.
     */
    _init(widget, source) {
        super._init();
        this.set_transient_for(widget._window);
        this.set_title(`${this.get_title()} \u2014 ${source.display_name}`);
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

        this._taskListPropertiesDialogSpinButton.set_value(interval);
        this._taskListPropertiesDialogComboBox.set_active_id(`${units}`);
    }

    /**
     * Fills Gtk.ComboBox with time units.
     */
    _fillTimeUnitComboBox() {
        const interval = this._taskListPropertiesDialogSpinButton.value;

        const time = new Map([
            [Utils.TIME_UNITS_['minutes'], _npgettext(
                'refresh every X minutes(s)', 'minute', 'minutes', interval)],
            [Utils.TIME_UNITS_['hours'], _npgettext(
                'refresh every X hour(s)', 'hour', 'hours', interval)],
            [Utils.TIME_UNITS_['days'], _npgettext(
                'refresh every X day(s)', 'day', 'days', interval)],
        ]);

        const active = this._taskListPropertiesDialogComboBox.active_id;
        this._taskListPropertiesDialogComboBox.remove_all();

        time.forEach((label, i) => this._taskListPropertiesDialogComboBox
            .append(`${i}`, label));

        if (active !== null)
            this._taskListPropertiesDialogComboBox.set_active_id(active);
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
    Template: _templatePath('settings-menu'),
    InternalChildren: [
        'aboutDialog',
        'supportLogDialog',
    ],
}, class SettingsMenuButton extends Gtk.MenuButton {
    /**
     * Initializes the settings menu.
     *
     * @param {TaskWidgetSettings} widget - Reference to the main widget class.
     */
    _init(widget) {
        super._init();
        const {modal} = widget._window;
        this._aboutDialog.transient_for = widget._window;
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
                widget._window.set_modal(false);

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
        action.connect('activate', () => this._aboutDialog.present());
        actionGroup.add_action(action);
        this.insert_action_group('settings-menu', actionGroup);

        if (!Utils.shellVersionAtLeast_(40)) {
            this._aboutDialog.connect('delete-event', () =>
                this._aboutDialog.hide_on_delete());
        }

        this._supportLogDialog.connect('response', (dialog, response) => {
            if (response === Gtk.ResponseType.OK)
                this._generateSupportLog(dialog._time);

            if (modal)
                widget._window.set_modal(true);

            this.set_sensitive(true);
            dialog._time = null;
            dialog.hide();
        });
    }

    /**
     * Generates the support log. User is notified to remove or censor any
     * information he/she considers to be private.
     *
     * @async
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
                shellTheme = 'Default / Unknown';
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
                (Adw ? 'Libadwaita ' + Adw.VERSION_S + '\n' : '') +
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
    Template: _templatePath('donate-menu'),
    InternalChildren: [
        'donateCrypto',
        'donateOptionsComboBox',
        'donateOptionsStack',
    ],
}, class DonateMenuButton extends Gtk.MenuButton {
    /**
     * Initializes the donations menu.
     *
     * @param {TaskWidgetSettings} widget - Reference to the main widget class.
     */
    _init(widget) {
        super._init();
        this._donateCrypto.set_transient_for(widget._window);
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
        action.connect('activate', () => this._donateCrypto.present());
        actionGroup.add_action(action);
        this.insert_action_group('donate-menu', actionGroup);

        if (!Utils.shellVersionAtLeast_(40)) {
            this._donateCrypto.connect('delete-event', () =>
                this._donateCrypto.hide_on_delete());
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

