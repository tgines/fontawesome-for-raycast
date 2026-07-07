import { useEffect, useState } from "react";
import {
  Action,
  ActionPanel,
  Color,
  Icon as RaycastIcon,
  List,
  getPreferenceValues,
  openExtensionPreferences,
} from "@raycast/api";
import { usePromise, showFailureToast } from "@raycast/utils";
import { searchIcons, type Icon } from "./fontawesome";

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
    <List
      isLoading={isLoading}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search Font Awesome icons (Classic / Regular)…"
      throttle
    >
      {!apiToken ? (
        <List.EmptyView
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
        <List.EmptyView
          icon={RaycastIcon.MagnifyingGlass}
          title="Search Font Awesome"
          description="Type an icon name or alias (e.g. user, coffee, arrow)."
        />
      ) : (
        results.map((icon) => <IconItem key={icon.id} icon={icon} />)
      )}
    </List>
  );
}

function IconItem({ icon }: { icon: Icon }) {
  const cssClass = `fa-regular fa-${icon.id}`;
  const unicode = `\\${icon.unicode}`;

  return (
    <List.Item
      icon={{ source: svgDataUri(icon.svg), tintColor: Color.PrimaryText }}
      title={icon.label}
      subtitle={icon.id}
      accessories={[{ text: unicode }]}
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
