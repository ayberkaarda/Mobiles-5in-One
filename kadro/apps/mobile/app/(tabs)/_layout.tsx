import { Tabs } from 'expo-router/js-tabs';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../src/theme';
import { TabIcon, type TabIconName } from '../../src/ui/TabIcon';

/** Route (Turkish slug, matching the web and deep link paths) and the copy key of each tab. */
const TABS: readonly { route: string; name: TabIconName }[] = [
  { route: 'maclar/index', name: 'matches' },
  { route: 'takimlar/index', name: 'teams' },
  { route: 'eksik-var/index', name: 'openCalls' },
  { route: 'sahalar/index', name: 'venues' },
  { route: 'profil/index', name: 'profile' },
];

export default function TabsLayout() {
  const { t } = useTranslation('common');
  const theme = useTheme();
  // Active tab: green as text (`primaryText`) on the light bar, chalk text on the dark bar.
  const activeTint = theme.scheme === 'dark' ? theme.colors.text : theme.colors.primaryText;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: activeTint,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
        tabBarLabelStyle: theme.typography.caption,
      }}
    >
      {TABS.map(({ route, name }) => (
        <Tabs.Screen
          key={route}
          name={route}
          options={{
            title: t(`tabs.${name}`),
            tabBarAccessibilityLabel: t(`tabs.${name}`),
            tabBarButtonTestID: `tab-${name}`,
            tabBarIcon: ({ color, size }) => <TabIcon name={name} color={color} size={size} />,
          }}
        />
      ))}
    </Tabs>
  );
}
