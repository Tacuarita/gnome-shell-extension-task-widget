'use strict';

const { Clutter, Gio, GLib, GObject, Shell, St } = imports.gi;

const CheckBox = imports.ui.checkBox;
const DateMenu = imports.ui.main.panel.statusArea.dateMenu.menu;
const Gettext = imports.gettext;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;

let ECal, EDataServer, ICalGLib;

if (Utils._HAS_EDS) {
    ECal = imports.gi.ECal;
    EDataServer = imports.gi.EDataServer;
    ICalGLib = imports.gi.ICalGLib;
}

const NC_ = (context, str) => `${context}\u0004${str}`;

const TaskWidget = GObject.registerClass(
class TaskWidget extends St.BoxLayout {
    /**
     * Initializes the widget.
     */
    _init() {
        super._init({
            name: 'taskWidget',
            // Re-use style classes. We'll do it wherever possible to
            // better reflect changes in GNOME Shell styling:
            style_class: 'datemenu-calendar-column task-widget-column \
                          message-list',
            vertical: true,
        });

        this._calendarArea = DateMenu.box.find_child_by_name('calendarArea');
        this._messageList = this._calendarArea.get_child_at_index(0);
        this._calendarWidget = this._calendarArea.get_child_at_index(1);
        this._calendarWidget.add_style_class_name('remove-margin');

        // Set the size of the widget to the size of the message list widget:
        this.add_constraint(new Clutter.BindConstraint({
            source: this._messageList,
            coordinate: Clutter.BindCoordinate.SIZE,
        }));

        // Place the widget next to GNOME's calendar widget:
        this._calendarArea.add_child(this);

        const dir = Me.metadata.schemas === 'user-specific'
            ? Me.dir.get_child('schemas').get_path() : Me.metadata.schemas;

        const gschema = Gio.SettingsSchemaSource.new_from_directory(
            dir, Gio.SettingsSchemaSource.get_default(),
            false);

        this._settings = new Gio.Settings({
            settings_schema: gschema.lookup(Me.metadata.base, true),
        });

        this.connect('destroy', this._onDestroy.bind(this));

        this._buildPlaceholder();
        this._initTaskLists();
    }

    /**
     * Builds and adds a placeholder which is used to display informational and
     * error messages.
     */
    _buildPlaceholder() {
        this._placeholder = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });

        const labeledIconBox = new St.BoxLayout({
            vertical: true,
            style_class: 'message-list-placeholder',
        });

        this._taskIcon = new St.Icon({
            gicon: Gio.ThemedIcon.new('checkbox-checked-symbolic'),
            style_class: 'task-icon',
        });

        this._statusLabel = new St.Label({
            text: _('Loading') + '…',
        });

        labeledIconBox.add_child(this._taskIcon);
        labeledIconBox.add_child(this._statusLabel);
        this._placeholder.add_child(labeledIconBox);
        this.add_child(this._placeholder);
    }

    /**
     * Initializes task lists.
     *
     * @todo https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/2661
     */
    async _initTaskLists() {
        try {
            this._contentBox = new St.BoxLayout({
                style_class: 'calendar world-clocks-button \
                              message-list-sections',
                vertical: true,
                visible: false,
            });

            this._contentBox.bind_property('visible', this._placeholder,
                'visible', GObject.BindingFlags.INVERT_BOOLEAN);

            this.add_child(this._contentBox);

            if (!Utils._HAS_EDS) {
                this._showPlaceholderWithStatus('no-eds');
                return;
            }

            // Holds references (ECal.ClientView) of all enabled task lists
            // so we can monitor changes in them:
            this._clientViews = new Map();
            // Controls cancellation of async events:
            this._cancellable = new Gio.Cancellable();
            // Limits the upper adjustment of the vertical scrollbar during
            // lazy loading of tasks:
            this._upperLimit = 0;

            await this._initSourceRegistry();
            await this._storeTaskLists(true);

            if (this._cancellable.is_cancelled())
                return;

            this._buildHeader();

            this._scrollView = new St.ScrollView({
                style_class: 'vfade',
            });

            this._scrollView.vscroll.adjustment.connect('notify::value',
                this._onTaskListScrolled.bind(this));

            this._taskBox = new St.BoxLayout({
                style_class: 'task-box',
                vertical: true,
            });

            this._scrollView.add_actor(this._taskBox);
            this._contentBox.add_child(this._scrollView);

            this._onMenuOpenId = DateMenu.connect('open-state-changed',
                this._onMenuOpen.bind(this));

            const themeContext = St.ThemeContext.get_for_stage(global.stage);
            this._loadThemeHacks(themeContext);

            this._themeChangedId = themeContext.connect('changed',
                this._loadThemeHacks.bind(this));

            this._settingsChangedId = this._settings.connect('changed',
                (...args) => {
                    this._onSettingsChangedOnGoing = true;
                    Utils._debounce(this._onSettingsChanged.bind(this), 250,
                        false)(...args);
                }
            );

            if (!this._taskLists.length) {
                this._showPlaceholderWithStatus('no-tasks');
                return;
            }

            this._showActiveTaskList(0);
        } catch (e) {
            logError(e);
        }
    }

    /**
     * Builds a header for task lists. The header consists of a task list name
     * and two buttons to switch to either previous or next task list.
     * Switching is also triggered by scrolling a mouse wheel on the header.
     *
     * @todo https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/2661
     */
    _buildHeader() {
        this._headerBox = new St.BoxLayout({
            reactive: true,
            x_expand: true,
        });

        this._headerBox.connect('scroll-event',
            this._onHeaderScrolled.bind(this));

        this._backButton = new St.Button({
            style_class: 'calendar-change-month-back pager-button',
            accessible_name: _('Previous task list'),
            can_focus: true,
        });

        this._backButton.add_actor(new St.Icon({
            icon_name: 'pan-start-symbolic',
        }));

        this._backButton.connect('clicked',
            this._onTaskListSwitched.bind(this, false));

        this._taskListName = new St.Label({
            style_class: 'calendar-month-label',
            x_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
            x_expand: true,
        });

        this._forwardButton = new St.Button({
            style_class: 'calendar-change-month-forward pager-button',
            accessible_name: _('Next task list'),
            can_focus: true,
        });

        this._forwardButton.add_actor(new St.Icon({
            icon_name: 'pan-end-symbolic',
        }));

        this._forwardButton.connect('clicked',
            this._onTaskListSwitched.bind(this, true));

        this._headerBox.add_child(this._backButton);
        this._headerBox.add_child(this._taskListName);
        this._headerBox.add_child(this._forwardButton);
        this._contentBox.add_child(this._headerBox);
    }

    /**
     * Initializes the source registry: defines task lists as desired
     * source type and connects signal handlers to monitor for task list
     * additions, removals and changes.
     */
    async _initSourceRegistry() {
        try {
            this._sourceType = EDataServer.SOURCE_EXTENSION_TASK_LIST;
            this._sourceRegistry = await Utils._getSourceRegistry(
                this._cancellable);

            this._taskListAddedId = this._sourceRegistry.connect(
                'source-added', (registry, source) => {
                    if (source.has_extension(this._sourceType))
                        this._onTaskListAdded(registry, source);
                }
            );

            this._taskListRemovedId = this._sourceRegistry.connect(
                'source-removed', (registry, source) => {
                    if (source.has_extension(this._sourceType))
                        this._onTaskListRemoved(registry, source);
                }
            );

            this._taskListChangedId = this._sourceRegistry.connect(
                'source-changed', (registry, source) => {
                    if (source.has_extension(this._sourceType))
                        this._onTaskListChanged(registry, source);
                }
            );
        } catch (e) {
            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;

            logError(e);
        }
    }

    /**
     * This stores a list of task list data (its UID and name) for quick
     * access. Data is sorted according to user-defined task list order.
     *
     * @param {boolean} [cleanup] - Cleanup the settings (remove obsolete task
     * list uids).
     */
    async _storeTaskLists(cleanup = false) {
        try {
            this._taskLists = [];
            const sources = this._sourceRegistry.list_sources(this._sourceType);
            const customOrder = this._settings.get_strv('task-list-order');
            const customSort = customOrder.length ? Utils._customSort.bind(
                this, customOrder) : undefined;

            await Promise.all(sources.map(source =>
                this._onTaskListAdded(null, source, customSort)));

            this._taskLists.sort(customSort);

            if (cleanup) {
                this._cleanupSettings(sources.sort(customSort).map(source =>
                    source.uid));
            }
        } catch (e) {
            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;

            logError(e);
        }
    }

    /**
     * Handles task list addition events and connects signal handlers to
     * monitor for its task additions, removals and changes.
     *
     * @param {EDataServer.SourceRegistry|null} registry - Source registry.
     * @param {EDataServer.Source} source - Task list that got added.
     */
    async _onTaskListAdded(registry, source) {
        try {
            let client;

            if (!this._clientViews.get(source.uid)) {
                // Since `source` is only a descriptor of a data source, we
                // need an `ECal.Client` - interface to access the data itself:
                client = await Utils._getECalClient(source,
                    ECal.ClientSourceType.TASKS, 1, this._cancellable);

                // `ECal.ClientView` allows to receive change notifications on
                // task lists, specifically task additions, removals and
                // changes. Tasks can be matched using a specified query - we
                // use `#t` here which matches all tasks:
                const view = await Utils._getECalClientView(client, '#t',
                    this._cancellable);

                view._taskAddedId = view.connect('objects-added',
                    this._onTaskEvent.bind(this));
                view._taskRemovedId = view.connect('objects-removed',
                    this._onTaskEvent.bind(this));
                view._taskChangedId = view.connect('objects-modified',
                    this._onTaskEvent.bind(this));

                // Do not report existing tasks as new tasks:
                view.set_flags(ECal.ClientViewFlags.NONE);
                view.start();

                this._clientViews.set(source.uid, view);
            } else {
                client = this._clientViews.get(source.uid).client;
            }

            if (this._settings.get_strv('disabled-task-lists')
                .indexOf(source.uid) !== -1)
                return;

            const tasks = await this._filterTasks(client);

            // If we hide empty and completed task lists, stop here:
            if (tasks === null)
                return;

            this._taskLists.push({
                uid: source.uid,
                name: source.display_name,
            });

            if (!this._taskBox || this._onSettingsChangedOnGoing)
                return;

            if (this._activeTaskList === undefined)
                this._showActiveTaskList(0);
            else
                this._showActiveTaskList(this._activeTaskList);
        } catch (e) {
            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;

            logError(e);
        }
    }

    /**
     * Handles task list removal events.
     *
     * @param {EDataServer.SourceRegistry|null} registry - Source registry.
     * @param {EDataServer.Source} source - Task list that got removed.
     */
    _onTaskListRemoved(registry, source) {
        const view = this._clientViews.get(source.uid);

        view.disconnect(view._taskAddedId);
        view.disconnect(view._taskRemovedId);
        view.disconnect(view._taskChangedId);
        view.stop();

        this._clientViews.delete(source.uid);

        // Check if removed task list is in the list of visible task lists:
        const index = this._taskLists.map(i => i.uid).indexOf(source.uid);

        // If not or if we're in extension disabling state (`registry` passed
        // as `null`), stop here:
        if (index === -1 || !registry)
            return;

        this._taskLists.splice(index, 1);

        if (!this._taskLists.length) {
            this._showPlaceholderWithStatus('no-tasks');
            return;
        }

        this._showActiveTaskList(Math.max(0, this._activeTaskList - 1));
    }

    /**
     * Handles task list change events.
     *
     * @param {EDataServer.SourceRegistry} registry - Source registry.
     * @param {EDataServer.Source} source - Task list that got changed.
     */
    _onTaskListChanged(registry, source) {
        const index = this._taskLists.map(i => i.uid).indexOf(source.uid);
        const taskList = this._taskLists[index];

        if (taskList !== undefined) {
            taskList.name = source.display_name;
            this._showActiveTaskList(this._activeTaskList);
        }
    }

    /**
     * Handles task events: additions, removals and changes.
     *
     * @param {ECal.ClientView} view - Task list which received the signal.
     * @param {ICalGLib.Component[]} tasks - List of tasks involved in
     * the task event.
     */
    async _onTaskEvent(view, tasks) {
        try {
            const uid = view.client.source.uid;
            const index = this._taskLists.map(i => i.uid).indexOf(uid);
            const taskList = this._taskLists[index];
            const updated = await this._filterTasks(view.client);

            if (updated && taskList === undefined) {
                // If we need to show a hidden task list which should not be
                // hidden anymore (because it's no longer empty or no longer
                // completed):
                if (index === -1) {
                    this._taskLists.push({
                        uid: view.client.source.uid,
                        name: view.client.source.display_name,
                    });
                }

                this._showActiveTaskList(this._activeTaskList === undefined
                    ? 0 : this._activeTaskList);
            } else if (!updated && taskList &&
                !this._cancellable.is_cancelled()) {
                // If we need to hide a visible task list (e.g. because it's
                // now empty or completed):
                this._taskLists.splice(index, 1);

                if (!this._taskLists.length) {
                    this._showPlaceholderWithStatus('no-tasks');
                    return;
                }

                this._showActiveTaskList(Math.max(0, this._activeTaskList - 1));
            } else if (updated && taskList) {
                // Task events (addition, removal and change) - simply refresh
                // the widget:
                this._showActiveTaskList(this._activeTaskList);
            }
        } catch (e) {
            logError(e);
        }
    }

    /**
     * For a given task list, lists tasks as checkboxes with labels and groups
     * them under appropriate group labels in the widget.
     *
     * @todo https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/3100
     *
     * @param {Object} taskList - Task list object.
     * @param {string} taskList.uid - Unique task list identifier.
     * @param {string} taskList.name  - Task list name.
     * @param {boolean} merge - Task lists will be merged into one.
     * @return {Promise<boolean>} `true` if there's at least one task.
     */
    async _listTasks(taskList, merge) {
        try {
            let prev = false;
            const today = new Date();

            // Dates have time-zone information, which can span regions with
            // different day light savings adjustments. To accurately calculate
            // day differences between two dates, we'll use this to convert
            // the dates to UTC first:
            const utc = x => Date.UTC(x.getFullYear(), x.getMonth(),
                x.getDate());

            let tasks;

            // Clicking on a checkbox must carry information about the task
            // list the task belongs to. Thus, here we will assign a
            // corresponding task list uid to each task:
            if (merge) {
                tasks = [].concat(...(await Promise.all(this._taskLists.map(
                    tl => this._filterTasks(this._clientViews.get(tl.uid)
                    .client)))).map((tl, index) => tl.map(task =>
                    [this._taskLists[index].uid, task])));
            } else {
                tasks = await this._filterTasks(this._clientViews.get(
                    taskList.uid).client);

                if (tasks)
                    tasks = tasks.map(task => [taskList.uid, task]);
            }

            if (!tasks || this._cancellable.is_cancelled())
                return;

            this._taskBox.destroy_all_children();

            // Initial sorting by name is necessary to ensure that tasks with no
            // due date are ordered consistently:
            for (const [uid, task] of tasks.sort(Utils._sortByName)
                .sort(Utils._sortByDueDate)) {

                if (task.get_summary() === null)
                    continue;

                const label = new St.Label({
                    style_class: 'world-clocks-header',
                });

                const due = task.get_due() ? new Date(task.get_due().get_value()
                    .as_timet() * 1000) : null;

                const checkbox = new CheckBox.CheckBox(task.get_summary()
                    .get_value());

                if (task.get_status() === ICalGLib.PropertyStatus.COMPLETED) {
                    checkbox.checked = true;
                    checkbox.getLabelActor().set_opacity(100);
                }

                checkbox.connect('clicked', () => this._taskClicked(checkbox,
                    this._clientViews.get(uid).client, task));

                // If a task belongs to an already created group:
                if ((due === null && due === prev) || (prev && due &&
                    due.toDateString() === prev.toDateString())) {
                    // Simply add the task:
                    this._taskBox.add_child(checkbox);
                } else {
                    // Otherwise, we need a new group label:
                    if (due === null) {
                        label.text = _('No due date');
                    } else if (due.toDateString() === today.toDateString()) {
                        label.text = _('Today');
                    } else if (due < today && this._settings.get_boolean(
                        'group-overdue-tasks')) {
                        label.text = _('Overdue');

                        if (prev) {
                            this._taskBox.add_child(checkbox);
                            continue;
                        }
                    } else {
                        let format = due.getYear() === today.getYear()
                            ? NC_('task due date', '%A, %B %-d')
                            : NC_('task due date with a year',
                                '%A, %B %-d, %Y');

                        format = Shell.util_translate_time_string(format);

                        const diff = utc(due) - utc(today);
                        const sign = Math.sign(diff) === 1 ? '+' : '-';

                        // Display translated and formatted due date label with
                        // number of days past/to due date:
                        label.text = due.toLocaleFormat(format) + ` (${sign}` +
                            `${Math.floor(Math.abs(diff) /
                            Utils._MSECS_IN_DAY)})`;
                    }
                    this._taskBox.add_child(label);
                    this._taskBox.add_child(checkbox);
                    prev = due;
                }

                // Lazy loading of tasks:
                const limit = this._upperLimit +
                    this.get_allocation_box().get_height();
                const upper = this._scrollView.vscroll.adjustment.upper;

                if (upper > limit) {
                    this._allTasksLoaded = false;
                    break;
                } else {
                    this._allTasksLoaded = true;
                }
            }
            return true;
        } catch (e) {
            logError(e);
        }
    }

    /**
     * Filters tasks and task lists based on user-defined settings.
     *
     * @param {ECal.Client} client - Task list to perform filtering on.
     * @return {Promise<ECal.Component[]|null>} List of tasks or `null`.
     */
    async _filterTasks(client) {
        try {
            // (User-defined) Hide completed tasks:
            const tasks = this._settings.get_int('hide-completed-tasks')
                ? await Utils._getTasks(client, this._hideCompletedTasks(),
                    this._cancellable)
                : await Utils._getTasks(client, '#t', this._cancellable);

            // (User-defined) Hide empty and completed task lists:
            if (this._settings.get_boolean('hide-empty-completed-task-lists')) {
                return tasks.map(task => task.get_status() ===
                    ICalGLib.PropertyStatus.COMPLETED).every(
                    status => status === true) ? null : tasks;
            } else {
                return tasks;
            }
        } catch (e) {
            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;

            logError(e);
        }
    }

    /**
     * Builds an S-expression to query tasks based on user-defined settings.
     *
     * @returns {string} An S-expression representing the task query.
     */
    _hideCompletedTasks() {
        const current = ICalGLib.Time.new_current_with_zone(
            ICalGLib.Timezone.get_utc_timezone());

        switch (this._settings.get_int('hide-completed-tasks')) {
            case Utils._HIDE_COMPLETED_TASKS['immediately']:
                return '(not is-completed?)';
            case Utils._HIDE_COMPLETED_TASKS['after-time-period']: {
                const adjust = this._settings.get_int('hct-apotac-value');

                switch (this._settings.get_int('hct-apotac-unit')) {
                    case Utils._TIME_UNITS['seconds']:
                        current.adjust(0, 0, 0, -adjust);
                        break;
                    case Utils._TIME_UNITS['minutes']:
                        current.adjust(0, 0, -adjust, 0);
                        break;
                    case Utils._TIME_UNITS['hours']:
                        current.adjust(0, -adjust, 0, 0);
                        break;
                    case Utils._TIME_UNITS['days']:
                        current.adjust(-adjust, 0, 0, 0);
                }
                return `(not (completed-before? (make-time "${
                    ECal.isodate_from_time_t(current.as_timet())}")))`;
            }
            case Utils._HIDE_COMPLETED_TASKS['after-specified-time']: {
                const start = ICalGLib.Time.new_current_with_zone(
                    ECal.util_get_system_timezone());
                start.set_time(0, 0, 0);
                start.convert_timezone(ECal.util_get_system_timezone(),
                    ICalGLib.Timezone.get_utc_timezone());

                const spec = ICalGLib.Time.new_current_with_zone(
                    ECal.util_get_system_timezone());
                spec.set_time(this._settings.get_int('hct-astod-hour'),
                    this._settings.get_int('hct-astod-minute'), 0);
                spec.convert_timezone(ECal.util_get_system_timezone(),
                    ICalGLib.Timezone.get_utc_timezone());

                if (current.compare(spec) === -1) {
                    return `(not (completed-before? (make-time "${
                        ECal.isodate_from_time_t(start.as_timet())}")))`;
                } else {
                    return '(not is-completed?)';
                }
            }
        }
    }

    /**
     * Handles task click events. Adds/removes styling and stores changes.
     *
     * @todo https://gitlab.gnome.org/GNOME/evolution-data-server/-/issues/246
     *
     * @param {Checkbox} checkbox - Task's checkbox that got clicked.
     * @param {ECal.Client} client - Task list that the task belongs to.
     * @param {ECal.Component} task - The task.
     */
    async _taskClicked(checkbox, client, task) {
        try {
            const label = checkbox.getLabelActor();

            if (checkbox.checked) {
                label.set_opacity(100);
                task.set_status(ICalGLib.PropertyStatus.COMPLETED);
                task.set_percent_complete(100);
                task.set_completed(ICalGLib.Time.new_current_with_zone(
                    ICalGLib.Timezone.get_utc_timezone()));
            } else {
                label.set_opacity(255);
                task.set_status(ICalGLib.PropertyStatus.NEEDSACTION);
                task.set_percent_complete(0);
                task.set_completed(null);
            }

            await Utils._modifyObject(client, task.get_icalcomponent(),
                ECal.ObjModType.THIS, ECal.OperationFlags.NONE,
                null);
        } catch (e) {
            logError(e);
        }
    }

    /**
     * Either sets and shows the active task list or shows the placeholder.
     *
     * @param {number|undefined} index - Index of the task list to activate or
     * `undefined` to show the placeholder instead.
     * @param {string} [text] - Text for the placeholder.
     */
    async _showActiveTaskList(index, text = null) {
        try {
            this._activeTaskList = index;

            if (this._showActiveTaskListOnGoing) {
                this._cancellable.cancel();
                return;
            }

            this._showActiveTaskListOnGoing = true;
            this._cancellable = new Gio.Cancellable();
            const merge = this._settings.get_boolean('merge-task-lists');

            if (index !== undefined && this._taskLists[index]) {
                const adjustment = this._scrollView.vscroll.adjustment.value;

                if (await this._listTasks(this._taskLists[index],
                    merge) === undefined)
                    return;

                // In the events that refresh the active task list (e.g.
                // clicking on a checkbox), we want to maintain the position of
                // the vertical scrollbar:
                this._scrollView.vscroll.adjustment.set_value(adjustment);

                const name = merge ? _('All Tasks')
                    : this._taskLists[index].name;

                this._taskListName.set_text(name);
                this._setHeader(merge);

                if (!this._contentBox.visible)
                    this._contentBox.show();
            } else {
                this._contentBox.hide();

                if (text)
                    this._statusLabel.set_text(text);
            }
        } catch (e) {
            logError(e);
        } finally {
            delete this._showActiveTaskListOnGoing;
        }
    }

    /**
     * Sets placeholder appearance and text.
     *
     * @param {string} status - String to differentiate between various
     * statuses of the placeholder.
     */
    _showPlaceholderWithStatus(status) {
        switch (status) {
            case 'no-tasks':
                this._taskIcon.gicon = Gio.ThemedIcon.new(
                    'checkbox-checked-symbolic');
                this._showActiveTaskList(undefined, _('No Tasks'));
                break;
            case 'no-eds':
                this._taskIcon.gicon = Gio.ThemedIcon.new(
                    'dialog-error-symbolic');
                this._showActiveTaskList(undefined,
                    _('Error: Missing Dependencies'));
        }
    }

    /**
     * Handles switching bewtween task lists in the task list header.
     *
     * @param {boolean} next - Show the next task list in the list.
     * @param {St.Button} button - Associated button.
     */
    _onTaskListSwitched(next, button) {
        let i = this._activeTaskList;

        if (next)
            i = ++i % this._taskLists.length;
        else if (i === 0)
            i = this._taskLists.length - 1;
        else
            i = --i;

        if (this._upperLimit) {
            this._upperLimit = 0;
            this._scrollView.vscroll.adjustment.set_values(0, 0, 0, 0, 0, 0);
        }

        button.grab_key_focus();
        this._showActiveTaskList(i);
    }

    /**
     * Task lists may have a lot of tasks. Loading them all in the widget may
     * noticeably delay the appearance of the top menu. To prevent that, we'll
     * do a lazy loading of tasks: initially only a small portion of them will
     * be loaded. The remaining ones will appear when user scrolls down.
     * This function allows to increase the upper adjustment of the vertical
     * scrollbar if that scrollbar is close to the end of the scrolled window.
     * That in turn will allow to load more tasks.
     *
     * @param {St.Adjustment} adjustment - Vertical scrollbar adjustment.
     * @param {GObject.ParamSpec} spec - Encapsulates metadata of object
     * properties.
     */
    _onTaskListScrolled(adjustment, spec) {
        if (this._allTasksLoaded || this._showActiveTaskListOnGoing)
            return;

        const height = this._taskBox.allocation.get_height();

        if (adjustment.upper - adjustment.value - height < 50) {
            this._upperLimit += height;
            this._showActiveTaskList(this._activeTaskList);
        }
    }

    /**
     * Sets task list header appearance: ensures that `back` and `forward`
     * buttons are shown to switch between task lists and optionally hides
     * task list header for singular task list:
     *
     * @param {boolean} merged - Task lists are merged into one.
     */
    _setHeader(merged) {
        const singular = this._taskLists.length === 1 || merged;

        if (singular) {
            this._backButton.hide();
            this._forwardButton.hide();
        } else {
            this._backButton.show();
            this._forwardButton.show();
        }

        if (!singular || !this._settings.get_boolean(
            'hide-header-for-singular-task-lists'))
            this._headerBox.show();
        else
            this._headerBox.hide();
    }

    /**
     * Handles scroll events on the task list header.
     *
     * @param {Clutter.Actor} actor - Actor the event is associated to.
     * @param {Clutter.Event} event - Holds information about the event.
     * @return {boolean} False to continue the propagation of the event.
     */
    _onHeaderScrolled(actor, event) {
        if (this._taskLists.length !== 1 &&
            !this._settings.get_boolean('merge-task-lists')) {
            switch (event.get_scroll_direction()) {
                case Clutter.ScrollDirection.DOWN:
                case Clutter.ScrollDirection.RIGHT:
                    this._onTaskListSwitched(true, this._forwardButton);
                    break;
                case Clutter.ScrollDirection.UP:
                case Clutter.ScrollDirection.LEFT:
                    this._onTaskListSwitched(false, this._backButton);
                    break;
            }
            return Clutter.EVENT_PROPAGATE;
        }
    }

    /**
     * Performs some styling tricks to improve compatibility with custom
     * Shell themes.
     *
     * @param {St.ThemeContext} context - Holds styling information.
     */
    _loadThemeHacks(context) {
        // Swap left and right margins for `contentBox` (because task
        // widget layout is a mirorr image of the message list layout):
        const [t, r, b, l] = [St.Side.TOP, St.Side.RIGHT, St.Side.BOTTOM,
            St.Side.LEFT].map(side => this._messageList._sectionList
            .get_theme_node().get_margin(side) / context.scale_factor);

        this._contentBox.set_style(`margin: ${t}px ${l}px ${b}px ${r}px`);
    }

    /**
     * Task list events may happen when the extension is disabled. In such
     * state, removing one or more task lists will not remove their uids from
     * extension settings. This method runs every time the extension loads and
     * removes such obsolete uids.
     *
     * @param {string[]} uids - List of task list uids ordered according to
     * custom user-defined order.
     */
    _cleanupSettings(uids) {
        const disabled = this._settings.get_strv('disabled-task-lists');

        if (disabled.length) {
            this._settings.set_strv('disabled-task-lists', disabled.filter(
                list => uids.indexOf(list) !== -1));
        }

        if (this._settings.get_strv('task-list-order').length)
            this._settings.set_strv('task-list-order', uids);

        Gio.Settings.sync();
    }

    /**
     * Shows the active task list whenever user opens the menu. Additionally,
     * initiates updates of the widget every 2 seconds (no remote calls, local
     * data only) if the following three conditions are true: the menu is kept
     * open, hiding of completed tasks is time dependent and the number of
     * occurred refreshes is <= 60.
     *
     * @param {Object|null} menu - Menu of a `dateMenu` button.
     * @param {boolean} isOpen - Menu is in its opened state.
     */
    _onMenuOpen(menu, isOpen) {
        if (isOpen && this._activeTaskList !== undefined &&
            !this._onSettingsChangedOnGoing) {
            this._showActiveTaskList(this._activeTaskList);

            let i = 0;
            const hct = this._settings.get_int('hide-completed-tasks');

            if (Utils._HIDE_COMPLETED_TASKS_IS_TIME_DEPENDENT(hct)) {
                this._refreshTimeoutId = GLib.timeout_add_seconds(
                    GLib.PRIORITY_DEFAULT, 2, () => {
                        this._showActiveTaskList(this._activeTaskList);

                        if (i++ < 60 && this._activeTaskList !== undefined)
                            return GLib.SOURCE_CONTINUE;
                        else
                            this._onMenuOpen(null, false);
                    }
                );
            }
        } else if (!isOpen) {
            if (this._refreshTimeoutId) {
                GLib.source_remove(this._refreshTimeoutId);
                delete this._refreshTimeoutId;
            }

            if (this._upperLimit) {
                this._upperLimit = 0;
                this._scrollView.vscroll.adjustment.set_values(
                    0, 0, 0, 0, 0, 0);
            }

            this._taskBox.destroy_all_children();
        }
    }

    /**
     * Updates the widget when extension settings change.
     *
     * @param {Gio.Settings} settings - API for storing and retrieving
     * extension settings.
     * @param {string} key - Name of the settings key that got changed.
     */
    async _onSettingsChanged(settings, key) {
        try {
            const active = this._activeTaskList !== undefined &&
                this._taskLists[this._activeTaskList] !== undefined
                ? this._taskLists[this._activeTaskList].uid : undefined;

            await this._storeTaskLists();

            if (!this._taskLists.length) {
                this._showPlaceholderWithStatus('no-tasks');
                return;
            }

            // If enabled task list is the only visible task list, show it:
            if (!this._contentBox.visible) {
                this._showActiveTaskList(0);
            } else {
                // Otherwise, either refresh the current active task list or,
                // if active task list is not visible anymore (i.e. we hid it),
                // show the first task list in the list of visible task lists:
                const index = this._taskLists.map(i => i.uid).indexOf(active);
                this._showActiveTaskList(index !== -1 ? index : 0);
            }
        } catch (e) {
            logError(e);
        } finally {
            delete this._onSettingsChangedOnGoing;
        }
    }

    /**
     * Cleanup. `ifs` prevent race conditions.
     */
    _onDestroy() {
        this._cancellable.cancel();
        this._calendarWidget.remove_style_class_name('remove-margin');

        if (this._themeChangedId) {
            St.ThemeContext.get_for_stage(global.stage).disconnect(
                this._themeChangedId);
        }

        if (this._settingsChangedId)
            this._settings.disconnect(this._settingsChangedId);

        if (this._refreshTimeoutId)
            GLib.source_remove(this._refreshTimeoutId);

        if (this._onMenuOpenId)
            DateMenu.disconnect(this._onMenuOpenId);

        if (this._taskListAddedId)
            this._sourceRegistry.disconnect(this._taskListAddedId);

        if (this._taskListRemovedId)
            this._sourceRegistry.disconnect(this._taskListRemovedId);

        if (this._taskListChangedId)
            this._sourceRegistry.disconnect(this._taskListChangedId);

        for (const [, view] of this._clientViews)
            this._onTaskListRemoved(null, view.client.source);
    }
});

let _widget;

function enable() {
    _widget = new TaskWidget();
}

function disable() {
    _widget.destroy();
    _widget = null;
}

function init() {
    const dir = Me.metadata.locale === 'user-specific'
        ? Me.dir.get_child('locale').get_path() : Me.metadata.locale;

    Gettext.textdomain(Me.metadata.base);
    Gettext.bindtextdomain(Me.metadata.base, dir);
}
