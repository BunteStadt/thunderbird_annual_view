# thunderbird_annual_view
Thunderbird Add On adding a Tab with configurable annual calender views.

## How to Release a new version

Create branches and commits as much as you want.

Once a state is reached for a new release, create a Tag for that commit. Then make sure to push the tag (diffent thing than pushing a commit).

The workflow should then automatically create a new release in GitHub and upload the xpi file to the release.

The `xpi` file can be created manually by downloading the repository and zipping the content (except the `.git` folder) into a file with the extension `.xpi`.
(Normal zip, than rename the extension to `.xpi`)
