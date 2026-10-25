using System.Windows.Input;
using Microsoft.Maui.Controls.Shapes;
using Path = Microsoft.Maui.Controls.Shapes.Path;

namespace Patika.App.Pages.Account;

/// <summary>
/// The 64 px header of the pushed account and urgent screens: a 48 px back (or close) target and the title,
/// over a 1 px Cizgi rule. <see cref="Command"/> defaults to going back.
/// </summary>
public sealed class PageHeader : ContentView
{
    private const string BackGlyph = "M15 5l-7 7 7 7";
    private const string CloseGlyph = "M6 6l12 12M18 6L6 18";

    public static readonly BindableProperty TitleProperty =
        BindableProperty.Create(nameof(Title), typeof(string), typeof(PageHeader), "", propertyChanged: (b, _, v) => ((PageHeader)b).title.Text = (string)v);

    public static readonly BindableProperty IsCloseProperty =
        BindableProperty.Create(nameof(IsClose), typeof(bool), typeof(PageHeader), false, propertyChanged: (b, _, _) => ((PageHeader)b).UpdateGlyph());

    public static readonly BindableProperty CommandProperty =
        BindableProperty.Create(nameof(Command), typeof(ICommand), typeof(PageHeader));

    private readonly Label title;
    private readonly Path glyph;
    private readonly Border target;

    public PageHeader()
    {
        glyph = new Path
        {
            Stroke = Token("Kaldirim"),
            StrokeThickness = 2.2,
            StrokeLineCap = PenLineCap.Round,
            StrokeLineJoin = PenLineJoin.Round,
            WidthRequest = 24,
            HeightRequest = 24,
            HorizontalOptions = LayoutOptions.Center,
            VerticalOptions = LayoutOptions.Center,
        };
        target = new Border
        {
            WidthRequest = 48,
            HeightRequest = 48,
            StrokeThickness = 0,
            BackgroundColor = Colors.Transparent,
            StrokeShape = new RoundRectangle { CornerRadius = 24 },
            Content = glyph,
        };
        var tap = new TapGestureRecognizer();
        tap.Tapped += async (_, _) => await GoAsync();
        target.GestureRecognizers.Add(tap);

        title = new Label
        {
            FontFamily = "NunitoExtraBold",
            FontSize = 20,
            VerticalOptions = LayoutOptions.Center,
            TextColor = Token("Kaldirim"),
        };
        SemanticProperties.SetHeadingLevel(title, SemanticHeadingLevel.Level1);

        var row = new Grid
        {
            ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)],
            ColumnSpacing = 4,
            Padding = new Thickness(8, 0),
            HeightRequest = 64,
        };
        row.Add(target, 0);
        row.Add(title, 1);

        Content = new VerticalStackLayout
        {
            Children = { row, new BoxView { HeightRequest = 1, Color = Token("Cizgi") } },
        };
        UpdateGlyph();
    }

    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    public bool IsClose
    {
        get => (bool)GetValue(IsCloseProperty);
        set => SetValue(IsCloseProperty, value);
    }

    public ICommand? Command
    {
        get => (ICommand?)GetValue(CommandProperty);
        set => SetValue(CommandProperty, value);
    }

    private void UpdateGlyph()
    {
        glyph.Data = (Geometry)new PathGeometryConverter().ConvertFromInvariantString(IsClose ? CloseGlyph : BackGlyph)!;
        SemanticProperties.SetDescription(target, IsClose ? "Vazgeç" : "Geri");
    }

    private async Task GoAsync()
    {
        if (Command is { } command)
        {
            if (command.CanExecute(null))
            {
                command.Execute(null);
            }

            return;
        }

        await Shell.Current.GoToAsync("..");
    }

    private static Color Token(string key) =>
        Application.Current?.Resources.TryGetValue(key, out var value) == true && value is Color color ? color : Colors.Black;
}
