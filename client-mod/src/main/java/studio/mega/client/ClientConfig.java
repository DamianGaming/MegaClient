package studio.mega.client;

import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

public final class ClientConfig {
    private static final Path PATH = FabricLoader.getInstance().getConfigDir().resolve("megaclient.properties");
    private static final Properties PROPERTIES = new Properties();

    private ClientConfig() {}

    public static void load() {
        PROPERTIES.setProperty("showFps", "true");
        PROPERTIES.setProperty("showCoordinates", "true");
        PROPERTIES.setProperty("showPing", "true");
        if (!Files.exists(PATH)) {
            save();
            return;
        }
        try (InputStream input = Files.newInputStream(PATH)) {
            PROPERTIES.load(input);
        } catch (IOException ignored) {
            // The defaults remain active when a local config cannot be read.
        }
    }

    public static boolean showFps() {
        return Boolean.parseBoolean(PROPERTIES.getProperty("showFps", "true"));
    }

    public static boolean showCoordinates() {
        return Boolean.parseBoolean(PROPERTIES.getProperty("showCoordinates", "true"));
    }

    public static boolean showPing() {
        return Boolean.parseBoolean(PROPERTIES.getProperty("showPing", "true"));
    }

    public static boolean toggle(String key) {
        boolean next = !Boolean.parseBoolean(PROPERTIES.getProperty(key, "true"));
        PROPERTIES.setProperty(key, Boolean.toString(next));
        save();
        return next;
    }

    public static void save() {
        try {
            Files.createDirectories(PATH.getParent());
            try (OutputStream output = Files.newOutputStream(PATH)) {
                PROPERTIES.store(output, "MegaClient companion settings");
            }
        } catch (IOException ignored) {
            // The HUD remains usable for the current session if persistence fails.
        }
    }
}
