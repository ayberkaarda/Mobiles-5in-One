using Patika.App.Pages.Animals;
using Patika.App.ViewModels.Adoption;

namespace Patika.App.Pages.Adoption;

internal sealed class AdoptionListContent : AnimalFeaturePage
{
    public AdoptionListContent(AdoptViewModel model) : base(model, "Sahiplen")
    {
        Heading("Yuva arayanlar");
        Body.Add(Text("İlanlar moderasyondan geçer, 60 gün sonra ya da hayvan yuvasına kavuşunca kapanır.", "Lede"));
        var district = new Entry { Placeholder = "İlçe (tüm ilçeler için boş bırak)" };
        district.SetBinding(Entry.TextProperty, "District");
        district.SetBinding(IsEnabledProperty, "IsNotBusy");
        SemanticProperties.SetDescription(district, "İlçe filtresi");
        Body.Add(district);
        var species = new Picker { Title = "Tür", ItemsSource = new[] { "Hepsi", "Kedi", "Köpek" }, MinimumHeightRequest = 44, TextColor = Resource<Color>("Kaldirim"), FontFamily = "NunitoSans", FontSize = Resource<double>("FontSizeBody") };
        species.SetBinding(Picker.SelectedItemProperty, "Species");
        species.SetBinding(IsEnabledProperty, "IsNotBusy");
        SemanticProperties.SetDescription(species, "Hayvan türü filtresi");
        Body.Add(species);
        Body.Add(Action("Filtrele", "RefreshCommand", "QuietButton"));
        Body.Add(Action("Taleplerim", "RequestsCommand", "LinkButton"));
        Body.Add(Rows("Items", () =>
        {
            var body = new VerticalStackLayout { Spacing = 8 };
            var photo = Photo("PhotoUrl", 72);
            photo.WidthRequest = 72;
            photo.SetBinding(IsVisibleProperty, "HasPhoto");
            var name = Bound("Name", "Title");
            SemanticProperties.SetHeadingLevel(name, SemanticHeadingLevel.Level2);
            body.Add(name);
            body.Add(Bound("Species", "ChipLabel", "TekirDeep"));
            body.Add(Bound("District", "Muted"));
            body.Add(Bound("Status", "Small"));
            body.Add(Bound("Closing", "Small", "TekirDeep"));
            var open = new Button { Text = "İlanı incele", MinimumHeightRequest = 44, Command = model.OpenCommand };
            open.SetBinding(Button.CommandParameterProperty, ".");
            open.SetBinding(SemanticProperties.DescriptionProperty, new Binding("Name", stringFormat: "{0} için ilanı incele"));
            body.Add(open);
            var card = new Grid { ColumnDefinitions = { new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star) }, ColumnSpacing = 12 };
            card.Add(photo);
            card.Add(body, 1);
            return new Border { BackgroundColor = Resource<Color>("Beyaz"), Stroke = Resource<Color>("Kaldirim"), StrokeThickness = 2, StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = new CornerRadius(40, 24, 40, 24) }, Padding = 16, Content = card };
        }));
        var empty = Text("Bu filtrelerle yuva arayan dost bulunamadı. Filtreleri değiştirebilirsin.", "Muted");
        empty.SetBinding(IsVisibleProperty, "IsEmpty");
        Body.Add(empty);
        var more = Action("Daha fazla ilan", "MoreCommand", "QuietButton");
        more.SetBinding(IsVisibleProperty, "HasMore");
        Body.Add(more);
        Retry();
    }
}

public sealed class AdoptionPostPage : AnimalFeaturePage
{
    private readonly AdoptionPostViewModel model;
    public AdoptionPostPage(AdoptionPostViewModel model) : base(model, "İlan")
    {
        this.model = model;
        var photo = Photo("Card.PhotoUrl", 168);
        photo.SetBinding(IsVisibleProperty, "Card.HasPhoto");
        Body.Add(photo);
        var name = Bound("Card.Name", "Display");
        SemanticProperties.SetHeadingLevel(name, SemanticHeadingLevel.Level1);
        Body.Add(name);
        Body.Add(Bound("Card.Species", "ChipLabel", "TekirDeep"));
        Body.Add(Bound("Card.District", "Muted"));
        Body.Add(Bound("Card.Status"));
        Body.Add(Bound("Card.Health", "Small", "NaneDeep"));
        Body.Add(Text("Hakkında", "Title", heading: true));
        Body.Add(Bound("Card.Post.Description"));
        Body.Add(Text("Beklentiler", "Title", heading: true));
        Body.Add(Bound("Card.Post.Requirements"));
        Body.Add(new Border { Style = Resource<Style>("Panel"), Content = Bound("Closing", "Small") });
        var request = Action("Sahiplenmek istiyorum", "RequestCommand");
        request.SetBinding(IsEnabledProperty, "CanRequest");
        Body.Add(request);
        Body.Add(Action("Profili", "ProfileCommand", "QuietButton"));
        Retry();
    }
    protected override void SetId(Guid id) => model.Id = id;
    protected override async void OnAppearing() { base.OnAppearing(); await model.LoadAsync(); }
}

public sealed class AdoptionRequestPage : AnimalFeaturePage
{
    public AdoptionRequestPage(AdoptionRequestViewModel model) : base(model, "Sahiplenme talebi")
    {
        Heading("Sahiplenme talebi");
        var form = new VerticalStackLayout { Spacing = 16 };
        form.SetBinding(IsVisibleProperty, "ShowForm");
        form.Add(Text("Gönüllü talebini okuyup uygulamadan yanıtlayacak. Acele etme; dürüst bir tanıtım en iyisi."));
        form.Add(Text("Kendini ve evini anlat", "FieldLabel"));
        var editor = new Editor { AutoSize = EditorAutoSizeOption.TextChanges, MinimumHeightRequest = 200, MaxLength = 3000, TextColor = Resource<Color>("Kaldirim"), BackgroundColor = Resource<Color>("Beyaz"), FontFamily = "NunitoSans", FontSize = Resource<double>("FontSizeBody") };
        editor.SetBinding(Editor.TextProperty, "Message");
        editor.SetBinding(IsEnabledProperty, "IsNotBusy");
        SemanticProperties.SetDescription(editor, "Kendini ve evini anlat. En fazla 3000 karakter.");
        form.Add(new Border { Style = Resource<Style>("Field"), Content = editor });
        form.Add(Bound("CharacterCount", "Muted"));
        form.Add(Bound("ValidationMessage", "ErrorText"));
        form.Add(new Border { Style = Resource<Style>("Panel"), Content = new VerticalStackLayout { Spacing = 8, Children = { Text("Yazarken aklında olsun", "Title", heading: true), Text("Yaşadığın ortamı, hayvan bakım deneyimini ve birlikte geçirebileceğin zamanı anlat.", "Small") } } });
        form.Add(Action("Talebi gönder", "SubmitCommand"));
        form.Add(Text("Talebini yalnızca ilan sahibi ve moderatörler görür.", "Muted"));
        Body.Add(form);
        var success = new Border { Style = Resource<Style>("Panel"), Content = Text("Talebin gönderildi", "Title", "NaneDeep", true) };
        success.SetBinding(IsVisibleProperty, "Succeeded");
        Body.Add(success);
        Body.Add(Action("Taleplerim", "RequestsCommand", "QuietButton"));
    }
    protected override void SetId(Guid id) => ((AdoptionRequestViewModel)BindingContext).Id = id;
}

public sealed class MyAdoptionRequestsPage : AnimalFeaturePage
{
    private readonly MyAdoptionRequestsViewModel model;
    public MyAdoptionRequestsPage(MyAdoptionRequestsViewModel model) : base(model, "Taleplerim")
    {
        this.model = model;
        Heading("Taleplerim");
        Body.Add(Rows("Items", () => new Border { Style = Resource<Style>("Panel"), Content = new VerticalStackLayout { Spacing = 8, Children = { Bound("State", "Title"), Bound("Message"), Bound("Reply", "Small") } } }));
        var empty = Text("Henüz sahiplenme talebin yok.", "Muted");
        empty.SetBinding(IsVisibleProperty, "IsEmpty");
        Body.Add(empty);
        var more = Action("Daha fazla talep", "MoreCommand", "QuietButton");
        more.SetBinding(IsVisibleProperty, "HasMore");
        Body.Add(more);
        Body.Add(Action("Yenile", "RefreshCommand", "QuietButton"));
    }
    protected override async void OnAppearing() { base.OnAppearing(); await model.RefreshAsync(); }
}
