# Task Widget

This is an independent fork of [Juozas Miškinis’s Task Widget](https://gitlab.com/jmiskinis/gnome-shell-extension-task-widget).
The fork adds GNOME Shell 51 compatibility, inline task creation and editing,
and subtask creation and deletion. The original project and its contributors
are credited in the Git history.

![gnome-shell-extension-task-widget-screenshot](https://gitlab.com/jmiskinis/gnome-shell-extension-task-widget/-/wikis/uploads/2c2c1cdec25c6df1ec8a5bf530b10c70/gnome-shell-extension-task-widget-screenshot.png)

Task Widget is an extension for GNOME that displays tasks next to the calendar widget. It integrates seamlessly with [GNOME Online Accounts](https://wiki.gnome.org/Projects/GnomeOnlineAccounts) and a number of GNOME applications, such as [Evolution](https://wiki.gnome.org/Apps/Evolution) and [Endeavour](https://wiki.gnome.org/Apps/Todo). With Task Widget you can:

- Easily access your task lists in the top menu
- Merge task lists
- Group tasks by due date
- Mark tasks as (un)completed
- Add and edit tasks, including notes and due dates
- Add subtasks or delete tasks from each task's three-dot menu
- Hide completed and empty task lists
- Hide completed tasks
- Toggle task list visibility and change its display order
- And more...

Use **Add task…** below the task list to create a task, or click a task title
to edit it inline. The three-dot button expands **Edit task**, **Add subtask**,
and **Delete** actions beneath the task. Editing and delete confirmation stay
inside the calendar panel. Press Enter in the title or choose **Save** to save;
Escape cancels. Closing the calendar preserves the current draft.

Due dates use `YYYY-MM-DD`, with **Today**, **Tomorrow**, and **No date**
shortcuts. Deleting a task also deletes its subtasks and recurring instances.
Read-only task lists cannot be edited.

## Build from source

See the [upstream installation guide](https://gitlab.com/jmiskinis/gnome-shell-extension-task-widget/-/wikis/Installation)
for dependencies. From this repository, run:

```sh
meson setup _build -Dbuild_zip=true
meson install -C _build
```

Run the install as your regular user. The fork uses the upstream extension UUID,
so this replaces an existing user installation of Task Widget. The ZIP is
written to `_build/task-widget@juozasmiskinis.gitlab.io.zip`.

The [upstream wiki](https://gitlab.com/jmiskinis/gnome-shell-extension-task-widget/-/wikis/home) documents the original extension.
The [GNOME Extensions listing](https://extensions.gnome.org/extension/3569/task-widget)
distributes the upstream version.

## License

Task Widget and this fork are distributed under the [GNU General Public License,
version 2](LICENSE).

<!-- Modified by Tacuarita on 2026-11-05 and 2026-11-23. -->
