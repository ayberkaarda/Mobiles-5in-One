using Patika.App.Core.Navigation;
using Patika.App.ViewModels.Adoption;

namespace Patika.App.Pages.Animals;

public abstract class AnimalFeaturePage : ContentPage, IQueryAttributable
{
    protected readonly VerticalStackLayout Body = new() { Padding = new Thickness(20, 24, 20, 32), Spacing = 16 };
    protected AnimalFeaturePage(AnimalFeatureViewModel model, string title)
    {
        BindingContext = model;
        Title = title;
        Content = new ScrollView { Content = Body };
        var offline = new Border { Style = Resource<Style>("OfflineBanner"), Content = Text("Çevrimdışısın. Yeniden bağlanıp tekrar dene.", color: "Kar") };
        offline.SetBinding(IsVisibleProperty, "IsOffline");
        Body.Add(offline);
        var busy = new ActivityIndicator { Color = Resource<Color>("TekirDeep") };
        busy.SetBinding(ActivityIndicator.IsRunningProperty, "IsBusy");
        busy.SetBinding(IsVisibleProperty, "IsBusy");
        SemanticProperties.SetDescription(busy, "Yükleniyor");
        Body.Add(busy);
        var error = Bound("ErrorMessage", "ErrorText");
        error.SetBinding(IsVisibleProperty, "HasError");
        Body.Add(error);
        Body.Add(Bound("Notice", color: "NaneDeep"));
    }
    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        SetId(query.TryGetValue(Routes.Keys.Id, out var value) && Guid.TryParse(value?.ToString(), out var id) ? id : Guid.Empty);
    }
    protected virtual void SetId(Guid id) { }
    protected override void OnAppearing()
    {
        base.OnAppearing();
        ((AnimalFeatureViewModel)BindingContext).Activate();
    }
    protected override void OnDisappearing()
    {
        ((AnimalFeatureViewModel)BindingContext).Deactivate();
        base.OnDisappearing();
    }
    protected static T Resource<T>(string key) => (T)Application.Current!.Resources[key];
    protected static Label Text(string text, string? style = null, string? color = null, bool heading = false)
    {
        var label = new Label { Text = text };
        if (style is not null) label.Style = Resource<Style>(style);
        if (color is not null) label.TextColor = Resource<Color>(color);
        if (heading) SemanticProperties.SetHeadingLevel(label, SemanticHeadingLevel.Level2);
        return label;
    }
    protected static Label Bound(string path, string? style = null, string? color = null)
    {
        var label = Text("", style, color);
        label.SetBinding(Label.TextProperty, path);
        return label;
    }
    protected static Button Action(string text, string command, string? style = null)
    {
        var button = new Button { Text = text, MinimumHeightRequest = 44, MinimumWidthRequest = 44, HeightRequest = 52, FontFamily = "NunitoExtraBold", FontSize = Resource<double>("FontSizeBody") };
        if (style is not null) button.Style = Resource<Style>(style);
        button.SetBinding(Button.CommandProperty, command);
        button.SetBinding(IsEnabledProperty, "IsNotBusy");
        SemanticProperties.SetDescription(button, text);
        return button;
    }
    protected void Heading(string title)
    {
        var label = Text(title, "Display");
        SemanticProperties.SetHeadingLevel(label, SemanticHeadingLevel.Level1);
        Body.Add(label);
    }
    protected void Retry()
    {
        var button = Action("Yeniden dene", "RefreshCommand", "QuietButton");
        button.SetBinding(IsVisibleProperty, "HasError");
        Body.Add(button);
    }
    protected static Image Photo(string path, double height)
    {
        var image = new Image { HeightRequest = height, Aspect = Aspect.AspectFill, BackgroundColor = Resource<Color>("Kum") };
        image.SetBinding(Image.SourceProperty, path);
        SemanticProperties.SetDescription(image, "Hayvan fotoğrafı");
        return image;
    }
    protected static VerticalStackLayout Rows(string source, Func<View> template)
    {
        var rows = new VerticalStackLayout { Spacing = 12 };
        BindableLayout.SetItemTemplate(rows, new DataTemplate(template));
        rows.SetBinding(BindableLayout.ItemsSourceProperty, source);
        return rows;
    }
}
