# TODO

- Add a full optional release/air date to the Macha catalogue wire model and persist it from metadata providers. For TMDB this should populate movie `release_date`, series `first_air_date`, season `air_date` and episode `air_date`. The client already has an optional `releaseDate` field and displays a neutral placeholder until the server supplies it.
- Implement the Android Media3 and Samsung Tizen AVPlay platform hosts against the existing player boundary.
