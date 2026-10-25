using System.Windows.Input;
using Patika.App.Core.Map;

namespace Patika.App.Drawing;

/// <summary>
/// The touch map: pan with one finger, pinch to zoom, tap a pin. <see cref="Viewport"/> is two-way and
/// follows every gesture frame; <see cref="SettledCommand"/> runs once a gesture ends, which is when the
/// view model asks the API for the new area.
/// </summary>
public sealed class MapSurface : GraphicsView
{
    public static readonly BindableProperty ViewportProperty = BindableProperty.Create(nameof(Viewport), typeof(MapViewport),
        typeof(MapSurface), MapViewport.Default(), BindingMode.TwoWay, propertyChanged: (b, _, value) =>
        {
            var surface = (MapSurface)b;
            surface.drawable.Viewport = (MapViewport)value;
            surface.Invalidate();
        });

    public static readonly BindableProperty PinsProperty = BindableProperty.Create(nameof(Pins), typeof(IReadOnlyList<MapPin>),
        typeof(MapSurface), Array.Empty<MapPin>(), propertyChanged: (b, _, value) =>
        {
            var surface = (MapSurface)b;
            surface.drawable.Pins = (IReadOnlyList<MapPin>?)value ?? [];
            surface.Invalidate();
        });

    public static readonly BindableProperty UserLocationProperty = BindableProperty.Create(nameof(UserLocation),
        typeof(GeoPoint?), typeof(MapSurface), null, propertyChanged: (b, _, value) =>
        {
            var surface = (MapSurface)b;
            surface.drawable.UserLocation = value is GeoPoint p ? (p.Latitude, p.Longitude) : null;
            surface.Invalidate();
        });

    public static readonly BindableProperty ShowCenterPinProperty = BindableProperty.Create(nameof(ShowCenterPin), typeof(bool),
        typeof(MapSurface), false, propertyChanged: (b, _, value) =>
        {
            var surface = (MapSurface)b;
            surface.drawable.ShowCenterPin = (bool)value;
            surface.Invalidate();
        });

    public static readonly BindableProperty PinTappedCommandProperty =
        BindableProperty.Create(nameof(PinTappedCommand), typeof(ICommand), typeof(MapSurface));

    public static readonly BindableProperty EmptyTappedCommandProperty =
        BindableProperty.Create(nameof(EmptyTappedCommand), typeof(ICommand), typeof(MapSurface));

    public static readonly BindableProperty SettledCommandProperty =
        BindableProperty.Create(nameof(SettledCommand), typeof(ICommand), typeof(MapSurface));

    private readonly StationMapDrawable drawable = new();
    private MapViewport? panStart;

    public MapSurface()
    {
        Drawable = drawable;
        var pan = new PanGestureRecognizer();
        pan.PanUpdated += OnPan;
        var pinch = new PinchGestureRecognizer();
        pinch.PinchUpdated += OnPinch;
        var tap = new TapGestureRecognizer();
        tap.Tapped += OnTap;
        GestureRecognizers.Add(pan);
        GestureRecognizers.Add(pinch);
        GestureRecognizers.Add(tap);
        SizeChanged += (_, _) =>
        {
            if (Width > 0 && Height > 0)
            {
                Viewport = Viewport.Resize(Width, Height);
                SettledCommand?.Execute(Viewport);
            }
        };
    }

    public MapViewport Viewport
    {
        get => (MapViewport)GetValue(ViewportProperty);
        set => SetValue(ViewportProperty, value);
    }

    public IReadOnlyList<MapPin> Pins
    {
        get => (IReadOnlyList<MapPin>)GetValue(PinsProperty);
        set => SetValue(PinsProperty, value);
    }

    public GeoPoint? UserLocation
    {
        get => (GeoPoint?)GetValue(UserLocationProperty);
        set => SetValue(UserLocationProperty, value);
    }

    public bool ShowCenterPin
    {
        get => (bool)GetValue(ShowCenterPinProperty);
        set => SetValue(ShowCenterPinProperty, value);
    }

    /// <summary>Runs with the <see cref="MapPin"/> under the finger.</summary>
    public ICommand? PinTappedCommand
    {
        get => (ICommand?)GetValue(PinTappedCommandProperty);
        set => SetValue(PinTappedCommandProperty, value);
    }

    public ICommand? EmptyTappedCommand
    {
        get => (ICommand?)GetValue(EmptyTappedCommandProperty);
        set => SetValue(EmptyTappedCommandProperty, value);
    }

    /// <summary>Runs with the final <see cref="MapViewport"/> after a pan, a pinch or a resize.</summary>
    public ICommand? SettledCommand
    {
        get => (ICommand?)GetValue(SettledCommandProperty);
        set => SetValue(SettledCommandProperty, value);
    }

    private void OnPan(object? sender, PanUpdatedEventArgs e)
    {
        switch (e.StatusType)
        {
            case GestureStatus.Started:
                panStart = Viewport;
                break;
            case GestureStatus.Running when panStart is not null:
                Viewport = panStart.Pan(e.TotalX, e.TotalY);
                break;
            case GestureStatus.Completed:
            case GestureStatus.Canceled:
                panStart = null;
                SettledCommand?.Execute(Viewport);
                break;
        }
    }

    private void OnPinch(object? sender, PinchGestureUpdatedEventArgs e)
    {
        switch (e.Status)
        {
            case GestureStatus.Running:
                var anchor = new ScreenPoint(e.ScaleOrigin.X * Width, e.ScaleOrigin.Y * Height);
                Viewport = Viewport.ZoomAt(e.Scale, anchor);
                break;
            case GestureStatus.Completed:
            case GestureStatus.Canceled:
                SettledCommand?.Execute(Viewport);
                break;
        }
    }

    private void OnTap(object? sender, TappedEventArgs e)
    {
        if (e.GetPosition(this) is not { } point)
        {
            return;
        }

        var pin = MapScene.HitTest(Pins, Viewport, new ScreenPoint(point.X, point.Y));
        if (pin is not null)
        {
            PinTappedCommand?.Execute(pin);
        }
        else
        {
            EmptyTappedCommand?.Execute(null);
        }
    }
}

/// <summary>A position to draw; a value type so bindings compare it by value.</summary>
public readonly record struct GeoPoint(double Latitude, double Longitude);
