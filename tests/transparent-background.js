// Run with a built extension ZIP:
// dbus-run-session gnome-shell-test-tool --headless --extension ZIP tests/transparent-background.js
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export const METRICS = {};

export async function run() {
    const extension = Main.extensionManager.lookup(
        'task-widget@juozasmiskinis.gitlab.io'
    );
    const widget = extension.stateObj._widget;
    const panel = widget._contentBox;
    const settings = widget._settings;
    const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
    const fixture = Gio.File.new_for_uri(import.meta.url)
        .get_parent().get_child('background-theme.css');
    theme.load_stylesheet(fixture);
    Main.panel.statusArea.dateMenu.menu.actor.add_style_class_name(
        'task-widget-test-theme'
    );

    for (const enabled of [false, true, false]) {
        settings.set_boolean('transparent-background', enabled);
        await Scripting.sleep(100);
        for (const state of ['', 'hover', 'focus', 'active']) {
            if (state) panel.add_style_pseudo_class(state);
            const node = panel.get_theme_node();
            const alpha = node.get_background_color().alpha;
            if ((alpha === 0) !== enabled)
                throw new Error(`Background alpha=${alpha}, enabled=${enabled}, state=${state}`);
            if (enabled && node.get_border_color(St.Side.TOP).alpha !== 0)
                throw new Error('Transparent panel still has a visible border');
            if (state) panel.remove_style_pseudo_class(state);
        }
    }
    print('PASS: background toggle overrides theme backgrounds in all states');
    // Disable before Shell destroys the calendar used by this extension.
    await Main.extensionManager.disableExtension(extension.uuid);
}
