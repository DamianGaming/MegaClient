package studio.mega.client;

import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.network.PlayerListEntry;
import net.minecraft.util.math.BlockPos;

import java.util.ArrayList;
import java.util.List;

public final class MegaHud {
    private MegaHud() {}

    public static void register() {
        HudRenderCallback.EVENT.register((context, tickCounter) -> render(context));
    }

    private static void render(DrawContext context) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.options.hudHidden || client.player == null || client.textRenderer == null) return;

        List<String> lines = new ArrayList<>();
        if (ClientConfig.showFps()) lines.add(client.getCurrentFps() + " FPS");
        if (ClientConfig.showCoordinates()) {
            BlockPos pos = client.player.getBlockPos();
            lines.add("XYZ " + pos.getX() + " / " + pos.getY() + " / " + pos.getZ());
        }
        if (ClientConfig.showPing() && client.getNetworkHandler() != null) {
            PlayerListEntry entry = client.getNetworkHandler().getPlayerListEntry(client.player.getUuid());
            if (entry != null) lines.add(entry.getLatency() + " ms");
        }
        if (lines.isEmpty()) return;

        int width = 0;
        for (String line : lines) width = Math.max(width, client.textRenderer.getWidth(line));
        int left = 8;
        int top = 8;
        int height = lines.size() * 12 + 10;
        context.fill(left, top, left + width + 18, top + height, 0xC90D0D14);
        context.fill(left, top, left + 3, top + height, 0xFFE31A5E);
        for (int index = 0; index < lines.size(); index++) {
            context.drawTextWithShadow(client.textRenderer, lines.get(index), left + 10, top + 6 + index * 12, 0xFFF6F2FF);
        }
    }
}
