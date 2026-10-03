import { fireEvent, screen } from '@testing-library/react-native/pure';
import { StyleSheet } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { darkTheme, lightTheme, pitchDiagram } from '../src/theme';
import {
  Badge,
  Button,
  Card,
  Chip,
  EksikSlot,
  EmptyState,
  KitNumber,
  ListItem,
  Numeral,
  PitchView,
  SegmentedControl,
  TextField,
} from '../src/ui';
import { renderWithProviders } from './support/render';

/** Host elements of one type in the rendered tree (the SVG test double renders named hosts). */
function hosts(type: string) {
  return screen.container.queryAll((instance) => instance.type === type);
}

function host(type: string) {
  const [first, ...rest] = hosts(type);
  if (first === undefined || rest.length > 0) {
    throw new Error(`expected one ${type}, found ${rest.length + (first === undefined ? 0 : 1)}`);
  }
  return first;
}

function flatStyle(style: unknown): Record<string, unknown> {
  return StyleSheet.flatten(style as Parameters<typeof StyleSheet.flatten>[0]) as Record<
    string,
    unknown
  >;
}

describe('restyled primitives', () => {
  it('Button: 48 pt, radius 8, disabled on fillMuted with muted label', async () => {
    await renderWithProviders(<Button label="Kaydet" onPress={() => undefined} disabled />);
    const button = screen.getByRole('button', { name: 'Kaydet' });
    const style = flatStyle(button.props.style);
    expect(style).toMatchObject({
      minHeight: 48,
      borderRadius: 8,
      backgroundColor: lightTheme.colors.fillMuted,
    });
    expect(flatStyle(screen.getByText('Kaydet').props.style).color).toBe(
      lightTheme.colors.textMuted,
    );
  });

  it('Button: secondary has the borderStrong outline; primary follows the dark scheme', async () => {
    await renderWithProviders(
      <>
        <Button label="Vazgeç" variant="secondary" onPress={() => undefined} />
        <Button label="Katıl" onPress={() => undefined} />
      </>,
      { scheme: 'dark' },
    );
    expect(flatStyle(screen.getByRole('button', { name: 'Vazgeç' }).props.style).borderColor).toBe(
      darkTheme.colors.borderStrong,
    );
    expect(
      flatStyle(screen.getByRole('button', { name: 'Katıl' }).props.style).backgroundColor,
    ).toBe(darkTheme.colors.primary);
    expect(flatStyle(screen.getByText('Katıl').props.style).color).toBe(darkTheme.colors.onPrimary);
  });

  it('TextField: input well, borderStrong outline, focus ring while focused', async () => {
    await renderWithProviders(<TextField label="Takım adı" value="" />);
    const input = screen.getByLabelText('Takım adı');
    expect(flatStyle(input.props.style)).toMatchObject({
      minHeight: 48,
      backgroundColor: lightTheme.colors.surfaceSunken,
      borderColor: lightTheme.colors.borderStrong,
      borderWidth: 1,
    });
    await fireEvent(input, 'focus');
    expect(flatStyle(screen.getByLabelText('Takım adı').props.style)).toMatchObject({
      borderColor: lightTheme.colors.focusRing,
      borderWidth: 2,
    });
  });

  it('TextField: error text uses dangerText', async () => {
    await renderWithProviders(<TextField label="E-posta" error="Geçerli bir adres gir" />);
    expect(flatStyle(screen.getByText('Geçerli bir adres gir').props.style).color).toBe(
      lightTheme.colors.dangerText,
    );
  });

  it('Card: hairline by default, raised layer on request', async () => {
    await renderWithProviders(
      <>
        <Card testID="flat">
          <></>
        </Card>
        <Card testID="raised" raised>
          <></>
        </Card>
      </>,
      { scheme: 'dark' },
    );
    expect(flatStyle(screen.getByTestId('flat').props.style)).toMatchObject({
      backgroundColor: darkTheme.colors.surface,
      borderColor: darkTheme.colors.border,
      borderRadius: 12,
    });
    expect(flatStyle(screen.getByTestId('raised').props.style)).toMatchObject({
      backgroundColor: darkTheme.colors.surfaceRaised,
      elevation: 6,
    });
  });

  it('ListItem: 56 pt rows, optional hairline and chevron', async () => {
    await renderWithProviders(
      <ListItem title="Moda Sahası" divider chevron onPress={() => undefined} testID="row" />,
    );
    const row = screen.getByTestId('row');
    expect(flatStyle(row.props.style)).toMatchObject({
      minHeight: 56,
      borderBottomWidth: 1,
      borderBottomColor: lightTheme.colors.border,
    });
    expect(hosts('Path')).toHaveLength(1);
  });

  it('EmptyState: shows the decorative eksik glyph above the title', async () => {
    await renderWithProviders(<EmptyState title="Henüz maç yok" message="İlk maçı aç." />);
    const svg = host('Svg');
    expect(svg.props.accessibilityElementsHidden).toBe(true);
    expect(screen.getByRole('header', { name: 'Henüz maç yok' })).toBeTruthy();
  });
});

describe('new primitives', () => {
  it('Badge: ÖRNEK on the warning fill, verified as green text with a check', async () => {
    await renderWithProviders(
      <>
        <Badge label="ÖRNEK" tone="sample" testID="sample" />
        <Badge label="Doğrulanmış" tone="verified" testID="verified" />
      </>,
    );
    expect(flatStyle(screen.getByTestId('sample').props.style).backgroundColor).toBe(
      lightTheme.colors.warning,
    );
    expect(flatStyle(screen.getByText('ÖRNEK').props.style).color).toBe(
      lightTheme.colors.onWarning,
    );
    expect(flatStyle(screen.getByText('Doğrulanmış').props.style).color).toBe(
      lightTheme.colors.primaryText,
    );
    expect(screen.getByLabelText('Doğrulanmış')).toBeTruthy();
  });

  it.each([
    ['light', lightTheme],
    ['dark', darkTheme],
  ] as const)(
    'Badge: the warning tone uses the warning roles in the %s scheme',
    async (scheme, theme) => {
      await renderWithProviders(<Badge label="Belki" tone="warning" testID="maybe" />, { scheme });
      expect(flatStyle(screen.getByTestId('maybe').props.style).backgroundColor).toBe(
        theme.colors.warning,
      );
      expect(flatStyle(screen.getByText('Belki').props.style).color).toBe(theme.colors.onWarning);
    },
  );

  it('Chip: rest and selected fills, pressable with a selected state', async () => {
    const onPress = vi.fn();
    await renderWithProviders(
      <>
        <Chip label="Kaleci" testID="static" />
        <Chip label="Kadıköy" selected onPress={onPress} testID="filter" />
      </>,
    );
    expect(flatStyle(screen.getByTestId('static').props.style)).toMatchObject({
      backgroundColor: lightTheme.colors.fillMuted,
      borderRadius: 4,
      minHeight: 32,
    });
    const filter = screen.getByRole('button', { name: 'Kadıköy' });
    expect(filter.props.accessibilityState).toMatchObject({ selected: true });
    expect(flatStyle(filter.props.style).backgroundColor).toBe(lightTheme.colors.inverse);
    await fireEvent.press(filter);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('SegmentedControl: radio group with state fills and per-option testIDs', async () => {
    const onSelect = vi.fn();
    await renderWithProviders(
      <SegmentedControl
        label="Katılımın"
        options={[
          { value: 'in', label: 'Geliyorum', tone: 'in' },
          { value: 'maybe', label: 'Belki', tone: 'maybe' },
          { value: 'out', label: 'Gelmiyorum', tone: 'out' },
        ]}
        selected="maybe"
        onSelect={onSelect}
        testID="rsvp"
      />,
      { scheme: 'dark' },
    );
    // The group is not one accessibility element (its radios stay focusable), so check its props.
    expect(screen.getByTestId('rsvp').props).toMatchObject({
      accessibilityRole: 'radiogroup',
      accessibilityLabel: 'Katılımın',
    });
    const maybe = screen.getByTestId('rsvp-maybe');
    expect(maybe.props.accessibilityState).toMatchObject({ checked: true });
    expect(flatStyle(maybe.props.style).backgroundColor).toBe(darkTheme.colors.warning);
    expect(flatStyle(screen.getByText('Belki').props.style).color).toBe(darkTheme.colors.onWarning);
    expect(flatStyle(screen.getByTestId('rsvp-in').props.style).minHeight).toBe(44);
    await fireEvent.press(screen.getByRole('radio', { name: 'Gelmiyorum' }));
    expect(onSelect).toHaveBeenCalledWith('out');
    await fireEvent.press(maybe);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('SegmentedControl: a locked control ignores presses and sits on fillMuted', async () => {
    const onSelect = vi.fn();
    await renderWithProviders(
      <SegmentedControl
        label="Katılımın"
        options={[
          { value: 'in', label: 'Geliyorum', tone: 'in' },
          { value: 'out', label: 'Gelmiyorum', tone: 'out' },
        ]}
        selected="in"
        onSelect={onSelect}
        disabled
        testID="rsvp"
      />,
    );
    expect(flatStyle(screen.getByTestId('rsvp').props.style).backgroundColor).toBe(
      lightTheme.colors.fillMuted,
    );
    await fireEvent.press(screen.getByTestId('rsvp-out'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId('rsvp-out').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('SegmentedControl: a single unavailable option is muted and ignores presses', async () => {
    const onSelect = vi.fn();
    await renderWithProviders(
      <SegmentedControl
        label="Katılımın"
        options={[
          { value: 'in', label: 'Geliyorum', tone: 'in' },
          { value: 'maybe', label: 'Belki', tone: 'maybe', disabled: true },
          { value: 'out', label: 'Gelmiyorum', tone: 'out' },
        ]}
        selected="in"
        onSelect={onSelect}
        testID="rsvp"
      />,
    );
    const maybe = screen.getByTestId('rsvp-maybe');
    expect(maybe.props.accessibilityState).toEqual({ checked: false, disabled: true });
    expect(flatStyle(maybe.props.style).backgroundColor).toBe(lightTheme.colors.fillMuted);
    expect(flatStyle(screen.getByText('Belki').props.style).color).toBe(
      lightTheme.colors.textMuted,
    );
    // The group itself stays enabled: the other options still answer.
    expect(flatStyle(screen.getByTestId('rsvp').props.style).backgroundColor).toBe(
      lightTheme.colors.surface,
    );
    await fireEvent.press(maybe);
    expect(onSelect).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('rsvp-out'));
    expect(onSelect).toHaveBeenCalledWith('out');
  });

  it('Numeral: condensed tabular figures; the outlined count keeps its spoken text', async () => {
    await renderWithProviders(
      <>
        <Numeral value="13/14" variant="numeralXL" testID="count" />
        <Numeral value={2} variant="score" outlined accessibilityLabel="2 eksik" testID="eksik" />
      </>,
    );
    expect(flatStyle(screen.getByTestId('count').props.style)).toMatchObject({
      fontFamily: 'ArchivoCondensed-ExtraBold',
      fontSize: 64,
      fontVariant: ['tabular-nums'],
    });
    expect(screen.getByLabelText('2 eksik')).toBeTruthy();
    const outline = host('SvgText');
    expect(outline.props).toMatchObject({ fill: 'none', stroke: lightTheme.colors.text });
  });

  it('KitNumber: inverts with the scheme', async () => {
    await renderWithProviders(<KitNumber number={7} testID="kit" />, { scheme: 'dark' });
    // Decorative (the row carries the spoken text), so it is hidden from accessibility queries.
    const hidden = { includeHiddenElements: true };
    expect(flatStyle(screen.getByTestId('kit', hidden).props.style)).toMatchObject({
      width: 32,
      backgroundColor: darkTheme.colors.text,
    });
    expect(flatStyle(screen.getByText('7', hidden).props.style).color).toBe(
      darkTheme.colors.background,
    );
  });

  it('EksikSlot: dashed outline, chalk on the pitch, labelled when given a name', async () => {
    await renderWithProviders(
      <EksikSlot surface="pitch" size={36} accessibilityLabel="Kaleci eksik" testID="slot" />,
    );
    expect(screen.getByLabelText('Kaleci eksik')).toBeTruthy();
    const circle = host('Circle');
    expect(circle.props).toMatchObject({
      stroke: lightTheme.colors.pitchLine,
      strokeDasharray: pitchDiagram.emptyMarkerDash,
    });
  });
});

describe('PitchView', () => {
  const markers = [
    { id: 'a1', x: 150, y: 40, number: 1, name: 'E. Kaya' },
    { id: 'b1', x: 150, y: 420, empty: true, emptyLabel: 'Kaleci eksik' },
  ];

  it.each(['light', 'dark'] as const)(
    'is the same night turf with chalk lines in the %s scheme',
    async (scheme) => {
      await renderWithProviders(
        <PitchView markers={markers} accessibilityLabel="A takımı 1, B takımı 0" testID="pitch" />,
        { scheme },
      );
      const turf = hosts('Rect')[0];
      expect(turf?.props.fill).toBe(lightTheme.colors.pitch);
      const svg = host('Svg');
      expect(svg.props.viewBox).toBe('0 0 300 460');
      const circles = hosts('Circle');
      expect(circles.find((c) => c.props.r === pitchDiagram.centreCircleRadius)?.props.stroke).toBe(
        lightTheme.colors.pitchLine,
      );
      expect(circles.find((c) => c.props.fill === lightTheme.colors.pitchMarker)).toBeTruthy();
      expect(
        circles.find((c) => c.props.strokeDasharray === pitchDiagram.emptyMarkerDash),
      ).toBeTruthy();
    },
  );

  it('is one accessible image and renders fully drawn (no animation to reduce)', async () => {
    await renderWithProviders(
      <PitchView markers={markers} accessibilityLabel="A takımı 1, B takımı 0" testID="pitch" />,
    );
    const pitch = screen.getByRole('image', { name: 'A takımı 1, B takımı 0' });
    expect(pitch.props.testID).toBe('pitch');
    expect(hosts('AnimatedPath')).toHaveLength(0);
    expect(hosts('SvgText')).toHaveLength(3);
    for (const label of ['1', 'E. Kaya', 'Kaleci eksik']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('reports the tapped marker', async () => {
    const onMarkerPress = vi.fn();
    await renderWithProviders(
      <PitchView
        markers={markers}
        accessibilityLabel="Diziliş"
        onMarkerPress={onMarkerPress}
        testID="pitch"
      />,
    );
    screen.getByTestId('pitch-marker-b1').props.onPress();
    expect(onMarkerPress).toHaveBeenCalledWith('b1');
  });
});
