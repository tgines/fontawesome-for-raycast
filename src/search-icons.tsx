import { useEffect, useState } from "react";
import {
  Action,
  ActionPanel,
  Color,
  Grid,
  Icon as RaycastIcon,
  getPreferenceValues,
  openExtensionPreferences,
} from "@raycast/api";
import { usePromise, showFailureToast } from "@raycast/utils";
import { searchIcons, type Icon } from "./fontawesome";

// ~8 columns keeps cells near 80px wide in the default Raycast window; the glyph
// is shrunk to roughly half the cell via a large inset. Raycast sizes cells by
// column count, not fixed pixels, so this is the closest to an 80px cell / 40px icon.
const COLUMNS = 8;

/** Debounce a fast-changing value so we don't hit the API on every keystroke. */
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export default function Command() {
  const { apiToken } = getPreferenceValues<{ apiToken: string }>();
  const [searchText, setSearchText] = useState("");
  const query = useDebounced(searchText);

  const { data: icons, isLoading } = usePromise(searchIcons, [query], {
    onError: (error) => {
      showFailureToast(error, { title: "Font Awesome search failed" });
    },
  });

  const results = icons ?? [];

  return (
    <Grid
      columns={COLUMNS}
      aspectRatio="1"
      fit={Grid.Fit.Contain}
      inset={Grid.Inset.Large}
      isLoading={isLoading}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search Font Awesome icons (Classic / Regular)…"
      throttle
    >
      {!apiToken ? (
        <Grid.EmptyView
          icon={RaycastIcon.Key}
          title="Add your API token"
          description="Open preferences and paste your Font Awesome API token to start searching."
          actions={
            <ActionPanel>
              <Action title="Open Extension Preferences" onAction={openExtensionPreferences} />
            </ActionPanel>
          }
        />
      ) : query.trim() === "" ? (
        <Grid.EmptyView
          icon={RaycastIcon.MagnifyingGlass}
          title="Search Font Awesome"
          description="Type an icon name or alias (e.g. user, coffee, arrow)."
        />
      ) : (
        results.map((icon) => <IconItem key={icon.id} icon={icon} />)
      )}
    </Grid>
  );
}

function IconItem({ icon }: { icon: Icon }) {
  const cssClass = `fa-regular fa-${icon.id}`;
  const unicode = `\\${icon.unicode}`;

  return (
    <Grid.Item
      content={{
        value: { source: svgDataUri(icon.svg), tintColor: Color.PrimaryText },
        tooltip: icon.label,
      }}
      title={icon.id}
      keywords={[icon.id]}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action.CopyToClipboard title="Copy Name" content={icon.id} />
            <Action.CopyToClipboard
              title="Copy SVG"
              content={icon.svg}
              shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
            />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action.CopyToClipboard
              title="Copy CSS Class"
              content={cssClass}
              shortcut={{ modifiers: ["cmd"], key: "." }}
            />
            <Action.CopyToClipboard
              title="Copy Unicode"
              content={unicode}
              shortcut={{ modifiers: ["cmd"], key: "u" }}
            />
            <Action.Paste title="Paste Name" content={icon.id} />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action.OpenInBrowser
              title="Open on Fontawesome.com"
              url={`https://fontawesome.com/icons/${icon.id}?f=classic&s=regular`}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}
