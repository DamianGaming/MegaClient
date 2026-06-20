package studio.mega.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;

public final class MegaMenuScreen extends Screen {
    private final Screen parent;
    private int panelLeft;
    private int panelTop;
    private int panelWidth;

    public MegaMenuScreen(Screen parent) {
        super(Text.literal("MegaClient"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        panelWidth = Math.min(440, width - 40);
        panelLeft = (width - panelWidth) / 2;
        panelTop = Math.max(28, height / 2 - 145);
        int buttonWidth = panelWidth - 56;
        int y = panelTop + 104;

        addDrawableChild(toggleButton("FPS", "showFps", ClientConfig.showFps(), y, buttonWidth));
        addDrawableChild(toggleButton("Coordinates", "showCoordinates", ClientConfig.showCoordinates(), y + 30, buttonWidth));
        addDrawableChild(toggleButton("Ping", "showPing", ClientConfig.showPing(), y + 60, buttonWidth));
        addDrawableChild(ButtonWidget.builder(Text.literal("Return to game"), button -> close())
            .dimensions(panelLeft + 28, y + 104, buttonWidth, 24)
            .build());
    }

    private ButtonWidget toggleButton(String label, String key, boolean enabled, int y, int width) {
        return ButtonWidget.builder(toggleText(label, enabled), button -> {
            boolean next = ClientConfig.toggle(key);
            button.setMessage(toggleText(label, next));
        }).dimensions(panelLeft + 28, y, width, 24).build();
    }

    private Text toggleText(String label, boolean enabled) {
        return Text.literal(label + " HUD: " + (enabled ? "On" : "Off"));
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        renderBackground(context, mouseX, mouseY, delta);
        int right = panelLeft + panelWidth;
        int bottom = panelTop + 278;
        context.fill(panelLeft, panelTop, right, bottom, 0xF20D0D14);
        context.fill(panelLeft, panelTop, panelLeft + 4, bottom, 0xFFE31A5E);
        context.drawCenteredTextWithShadow(textRenderer, Text.literal("MEGACLIENT"), width / 2, panelTop + 25, 0xFFF6F2FF);
        context.drawCenteredTextWithShadow(textRenderer, Text.literal("Lightweight local companion"), width / 2, panelTop + 48, 0xFFA098F6);
        context.drawCenteredTextWithShadow(textRenderer, Text.literal("Right Shift opens this panel"), width / 2, panelTop + 70, 0xFF827C91);
        super.render(context, mouseX, mouseY, delta);
    }

    @Override
    public void close() {
        if (client != null) client.setScreen(parent);
    }

    @Override
    public boolean shouldPause() {
        return false;
    }
}
