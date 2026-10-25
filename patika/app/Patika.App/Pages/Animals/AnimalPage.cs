using Patika.App.ViewModels.Animals;

namespace Patika.App.Pages.Animals;

public sealed class AnimalPage : AnimalFeaturePage
{
    private readonly AnimalViewModel model;
    public AnimalPage(AnimalViewModel model) : base(model, "Hayvan profili")
    {
        this.model = model;
        var tag = new VerticalStackLayout { Spacing = 8 };
        tag.Add(Bound("Species", "ChipLabel", "TekirDeep"));
        var name = Bound("Name", "Display");
        SemanticProperties.SetHeadingLevel(name, SemanticHeadingLevel.Level1);
        tag.Add(name);
        tag.Add(Bound("Status"));
        tag.Add(Bound("Animal.District", "Muted"));
        tag.Add(Bound("Health", "Small", "NaneDeep"));
        tag.Add(Bound("Followers", "Muted"));
        Body.Add(new Border { Style = Resource<Style>("CollarTag"), Content = tag });
        var follow = Action("Takip et", "FollowCommand");
        follow.SetBinding(Button.TextProperty, "FollowText");
        follow.SetBinding(SemanticProperties.DescriptionProperty, "FollowText");
        Body.Add(follow);
        var note = new Entry { Placeholder = "Görülme notu (isteğe bağlı)", MaxLength = 1000 };
        note.SetBinding(Entry.TextProperty, "SightingNote");
        SemanticProperties.SetDescription(note, "Görülme notu, isteğe bağlı");
        Body.Add(note);
        Body.Add(Action("Bugün gördüm", "SightCommand", "QuietButton"));
        Body.Add(Text("Fotoğraflar", "Title", heading: true));
        var photos = new HorizontalStackLayout { Spacing = 8 };
        photos.SetBinding(BindableLayout.ItemsSourceProperty, "Photos");
        BindableLayout.SetItemTemplate(photos, new DataTemplate(() =>
        {
            var image = Photo("PhotoUrl", 82);
            image.WidthRequest = 82;
            return image;
        }));
        Body.Add(new ScrollView { Orientation = ScrollOrientation.Horizontal, Content = photos });
        var noPhotos = Text("Henüz fotoğraf yok.", "Muted");
        noPhotos.SetBinding(IsVisibleProperty, "NoPhotos");
        Body.Add(noPhotos);
        var morePhotos = Action("Diğer fotoğraflar", "MorePhotosCommand", "QuietButton");
        morePhotos.SetBinding(IsVisibleProperty, "HasMorePhotos");
        Body.Add(morePhotos);
        Body.Add(Text("Görülme kayıtları", "Title", heading: true));
        Body.Add(Rows("Sightings", () => new VerticalStackLayout { Spacing = 4, Children = { Bound("Date", "ChipLabel"), Bound("Note", "Small"), new BoxView { HeightRequest = 1 } } }));
        var noSightings = Text("Henüz görülme kaydı yok.", "Muted");
        noSightings.SetBinding(IsVisibleProperty, "NoSightings");
        Body.Add(noSightings);
        var more = Action("Daha fazla görülme", "MoreSightingsCommand", "QuietButton");
        more.SetBinding(IsVisibleProperty, "HasMoreSightings");
        Body.Add(more);
        Retry();
    }
    protected override void SetId(Guid id) => model.Id = id;
    protected override async void OnAppearing() { base.OnAppearing(); await model.LoadAsync(); }
}
